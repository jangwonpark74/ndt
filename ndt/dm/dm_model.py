"""CSV normalization and durable Test ID registry."""
import csv
import hashlib
import io
import json
import math
import os
import re
import sqlite3
import uuid
import zlib
from copy import deepcopy
from contextlib import contextmanager
from datetime import datetime, timezone

REQUIRED = ("timestamp", "latitude", "longitude", "rat")
LIMITS = {
    "latitude": (-90, 90), "longitude": (-180, 180), "pci": (0, 1007),
    "arfcn": (0, 3279165), "rsrp_dbm": (-180, 0), "rsrq_db": (-60, 30),
    "sinr_db": (-60, 80), "dl_mbps": (0, 100000), "ul_mbps": (0, 100000),
    "latency_ms": (0, 3600000), "predicted_rx_dbm": (-300, 90),
}
TEXT = ("cell_id", "band", "event")
COLUMNS = REQUIRED + ("band", "pci", "arfcn", "cell_id", "rsrp_dbm", "rsrq_db", "sinr_db",
                      "dl_mbps", "ul_mbps", "latency_ms", "predicted_rx_dbm", "event")
MAX_BYTES = 16 * 1024 * 1024
MAX_ROWS = 100_000
ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
ISO = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)")
NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?")
DEFAULT_PROFILE = {
    "name": "Field acceptance", "gap": 10, "minSamples": 30,
    "minCoveragePct": 90, "minGpsPct": 90, "maxFailPct": 5,
    "thresholds": {key: {"LTE": lte, "NR": nr} for key, lte, nr in (
        ("rsrp_dbm", -105, -105), ("rsrq_db", -15, -15), ("sinr_db", 0, 0),
        ("dl_mbps", 20, 50), ("ul_mbps", 5, 10), ("latency_ms", 60, 60), ("predicted_rx_dbm", -100, -100))},
}


class Conflict(ValueError):
    """An analyst is editing an outdated workspace revision."""


def validate_profile(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULT_PROFILE):
        raise ValueError("Provide a complete analysis profile.")
    if not isinstance(value["name"], str) or not 1 <= len(value["name"].strip()) <= 80 or any(ord(c) < 32 for c in value["name"]):
        raise ValueError("Profile name must be 1–80 plain-text characters.")
    for key, low, high in (("gap", 1, 3600), ("minSamples", 1, MAX_ROWS),
                           ("minCoveragePct", 0, 100), ("minGpsPct", 0, 100), ("maxFailPct", 0, 100)):
        number = value[key]
        if type(number) not in (int, float) or not math.isfinite(number) or not low <= number <= high:
            raise ValueError(f"{key} must be between {low} and {high}.")
        if key in ("gap", "minSamples") and int(number) != number:
            raise ValueError(f"{key} must be an integer.")
    thresholds = value["thresholds"]
    if not isinstance(thresholds, dict) or set(thresholds) != set(DEFAULT_PROFILE["thresholds"]):
        raise ValueError("Provide thresholds for all supported metrics.")
    for metric, limits in thresholds.items():
        if not isinstance(limits, dict) or set(limits) != {"LTE", "NR"}:
            raise ValueError("Each metric needs LTE and NR thresholds.")
        low, high = LIMITS[metric]
        if any(type(n) not in (int, float) or not math.isfinite(n) or not low <= n <= high for n in limits.values()):
            raise ValueError(f"{metric} thresholds must be between {low} and {high}.")
    return deepcopy(value)


def normalize(raw):
    if not 0 < len(raw) <= MAX_BYTES:
        raise ValueError("CSV must be between 1 byte and 16 MiB.")
    try:
        decoded = raw.decode("utf-8-sig")
    except UnicodeError as exc:
        raise ValueError("CSV must use UTF-8 encoding.") from exc
    if "\0" in decoded:
        raise ValueError("CSV contains a NUL character.")
    reader = csv.reader(io.StringIO(decoded, newline=""), strict=True)
    try:
        headers = [cell.strip().lower() for cell in next(reader, [])]
        if len(set(headers)) != len(headers) or not set(REQUIRED).issubset(headers):
            raise ValueError("CSV needs unique headers timestamp, latitude, longitude and rat.")
        rows, seen = [], set()
        for cells in reader:
            if not cells or (len(cells) == 1 and not cells[0].strip()):
                continue
            if len(cells) != len(headers) or len(rows) >= MAX_ROWS:
                raise ValueError(f"Line {reader.line_num}: check column count or the {MAX_ROWS:,}-row limit.")
            values = {key: cell.strip() for key, cell in zip(headers, cells)}
            try:
                stamp = values["timestamp"]
                if not ISO.fullmatch(stamp):
                    raise ValueError("timestamp must be ISO 8601 with a UTC offset and up to milliseconds")
                time = datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(timezone.utc)
                since_epoch = time - EPOCH
                t = (since_epoch.days * 86400 + since_epoch.seconds) * 1000 + since_epoch.microseconds // 1000
                rat = {"LTE": "LTE", "4G": "LTE", "NR": "NR", "5G": "NR"}.get(values["rat"].upper())
                if not rat:
                    raise ValueError("rat must be LTE or NR (4G and 5G aliases accepted)")
                key = (t, rat)
                if key in seen:
                    raise ValueError("duplicate timestamp within the same RAT")
                row = {"t": t, "rat": rat}
                for field, (low, high) in LIMITS.items():
                    value = values.get(field, "")
                    if not value:
                        continue
                    if not NUMBER.fullmatch(value):
                        raise ValueError(f"{field} must be numeric")
                    number = float(value)
                    maximum = 503 if field == "pci" and rat == "LTE" else high
                    if not math.isfinite(number) or not low <= number <= maximum:
                        raise ValueError(f"{field} must be between {low} and {maximum}")
                    if field in ("pci", "arfcn"):
                        if not number.is_integer():
                            raise ValueError(f"{field} must be an integer")
                        number = int(number)
                    row[field] = number
                if ("latitude" in row) != ("longitude" in row):
                    raise ValueError("latitude and longitude must both be present or both blank")
                for field in TEXT:
                    value = values.get(field, "")
                    if len(value) > 160 or any(ord(ch) < 32 for ch in value):
                        raise ValueError(f"{field} must be plain text of up to 160 characters")
                    if value:
                        row[field] = value
            except (ValueError, OverflowError) as exc:
                raise ValueError(f"Line {reader.line_num}: {exc}.") from exc
            rows.append(row)
            seen.add(key)
    except csv.Error as exc:
        raise ValueError(f"Invalid CSV near line {reader.line_num}: {exc}.") from exc
    if not rows:
        raise ValueError("CSV contains no observations.")
    rows.sort(key=lambda row: (row["t"], row["rat"]))
    return rows


@contextmanager
def connection(path):
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        with db:
            yield db
    finally:
        db.close()


TESTS_SQL = """CREATE TABLE IF NOT EXISTS tests (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, scope TEXT NOT NULL,
    label TEXT NOT NULL, notes TEXT NOT NULL, source TEXT NOT NULL, sha256 TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('imported','synthetic','simulated')), created TEXT NOT NULL,
    start INTEGER NOT NULL, end INTEGER NOT NULL, count INTEGER NOT NULL, payload BLOB NOT NULL)"""


def initialize(path):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        descriptor = os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    except FileExistsError:
        pass
    else:
        os.close(descriptor)
    # Rebuild only the old kind constraint; child references retain the unchanged tests name.
    db = sqlite3.connect(path)
    try:
        old = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='tests'").fetchone()
        if old and "'simulated'" not in old[0]:
            db.execute('PRAGMA foreign_keys=OFF')
            db.execute('BEGIN IMMEDIATE')
            db.execute(TESTS_SQL.replace('IF NOT EXISTS tests', 'tests_upgrade'))
            db.execute('INSERT INTO tests_upgrade SELECT * FROM tests')
            db.execute('DROP TABLE tests')
            db.execute('ALTER TABLE tests_upgrade RENAME TO tests')
            if db.execute('PRAGMA foreign_key_check').fetchall():
                raise ValueError('DM registry migration failed its foreign-key check.')
            db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()
    with connection(path) as db:
        db.execute(TESTS_SQL)
        db.execute("""CREATE TABLE IF NOT EXISTS workspaces (
            test_id TEXT PRIMARY KEY REFERENCES tests(id), revision INTEGER NOT NULL, profile TEXT NOT NULL
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS issues (
            id TEXT PRIMARY KEY, test_id TEXT NOT NULL REFERENCES tests(id), t INTEGER NOT NULL,
            rat TEXT NOT NULL, metric TEXT NOT NULL, title TEXT NOT NULL, note TEXT NOT NULL,
            severity TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS audit (
            sequence INTEGER PRIMARY KEY, test_id TEXT NOT NULL REFERENCES tests(id),
            at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, profile TEXT
        )""")
        if "profile" not in {row["name"] for row in db.execute("PRAGMA table_info(audit)")}:
            db.execute("ALTER TABLE audit ADD COLUMN profile TEXT")
        db.execute("CREATE INDEX IF NOT EXISTS issues_test ON issues(test_id, created)")
        db.execute("CREATE INDEX IF NOT EXISTS audit_test ON audit(test_id, sequence)")
        db.execute('''CREATE TABLE IF NOT EXISTS test_contexts (
            test_id TEXT PRIMARY KEY REFERENCES tests(id), snapshot TEXT NOT NULL, association TEXT)''')
        db.execute('''CREATE TABLE IF NOT EXISTS route_associations (
            id TEXT PRIMARY KEY,test_id TEXT NOT NULL REFERENCES tests(id),snapshot TEXT NOT NULL,
            association TEXT NOT NULL,created TEXT NOT NULL)''')


META = "id, scope, label, notes, source, sha256, kind, created, start, end, count"


def metadata(row):
    result = dict(row)
    result["scope"] = json.loads(result["scope"])
    return result


def list_tests(path):
    with connection(path) as db:
        return [metadata(row) for row in db.execute(
            f"SELECT {META} FROM tests ORDER BY (kind='synthetic'), created DESC, id DESC")]


def get_test(path, test_id):
    with connection(path) as db:
        row = db.execute(f"SELECT {META}, payload FROM tests WHERE id=?", (test_id,)).fetchone()
        context = db.execute('SELECT snapshot,association FROM test_contexts WHERE test_id=?', (test_id,)).fetchone()
    if row is None:
        return None
    result = dict(row)
    payload = result.pop("payload")
    return {**metadata(result), "rows": json.loads(zlib.decompress(payload)), **workspace(path, test_id),
            'context': json.loads(context['snapshot']) if context else None,
            'association': json.loads(context['association']) if context and context['association'] else None}


def workspace(path, test_id):
    with connection(path) as db:
        row = db.execute("SELECT revision,profile FROM workspaces WHERE test_id=?", (test_id,)).fetchone()
        issues = [dict(r) for r in db.execute("SELECT * FROM issues WHERE test_id=? ORDER BY created,id", (test_id,))]
        audit = [dict(r) for r in db.execute("SELECT * FROM audit WHERE test_id=? ORDER BY sequence DESC LIMIT 100", (test_id,))]
        for entry in audit:
            entry["profile"] = json.loads(entry["profile"]) if entry["profile"] else None
    profile = json.loads(row['profile']) if row else deepcopy(DEFAULT_PROFILE)
    profile['thresholds'].setdefault('predicted_rx_dbm', deepcopy(DEFAULT_PROFILE['thresholds']['predicted_rx_dbm']))
    return {"revision": row["revision"] if row else 0, "profile": profile, "issues": issues, "audit": audit}


def audit_entry(db, test_id, action, detail, profile=None):
    db.execute("INSERT INTO audit(test_id,at,action,detail,profile) VALUES (?,?,?,?,?)",
               (test_id, datetime.now(timezone.utc).isoformat(), action, detail,
                json.dumps(profile, ensure_ascii=False, sort_keys=True) if profile else None))


def save_profile(path, test_id, revision, profile):
    profile = validate_profile(profile)
    if type(revision) is not int or revision < 0:
        raise ValueError("Workspace revision must be a nonnegative integer.")
    with connection(path) as db:
        db.execute("BEGIN IMMEDIATE")
        if not db.execute("SELECT 1 FROM tests WHERE id=?", (test_id,)).fetchone():
            raise LookupError("Test ID not found.")
        current = db.execute("SELECT revision FROM workspaces WHERE test_id=?", (test_id,)).fetchone()
        if (current[0] if current else 0) != revision:
            raise Conflict("This profile changed in another tab. Reload the run before saving again.")
        db.execute("INSERT INTO workspaces VALUES (?,?,?) ON CONFLICT(test_id) DO UPDATE SET revision=excluded.revision,profile=excluded.profile",
                   (test_id, revision + 1, json.dumps(profile, ensure_ascii=False, sort_keys=True)))
        audit_entry(db, test_id, "Profile saved", f"Revision {revision + 1} · {profile['name']}", profile)
    return workspace(path, test_id)


def save_issue(path, test_id, value):
    if not isinstance(value, dict) or set(value) != {"id", "t", "rat", "metric", "title", "note", "severity"}:
        raise ValueError("Provide a sample, metric, title and severity for this issue.")
    try:
        issue_id = str(uuid.UUID(value["id"]))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("Issue ID must be a UUID.") from exc
    for key, maximum, required in (("title", 120, True), ("note", 1000, False)):
        text = value[key]
        if not isinstance(text, str) or len(text) > maximum or (required and not text.strip()) or any(ord(c) < 32 and c != "\n" for c in text):
            raise ValueError(f"{key} must be plain text of up to {maximum} characters.")
    if value["severity"] not in ("high", "medium", "low") or not isinstance(value["metric"], str) or value["metric"] not in DEFAULT_PROFILE["thresholds"]:
        raise ValueError("Choose a valid severity and metric.")
    test = get_test(path, test_id)
    if not test:
        raise LookupError("Test ID not found.")
    if type(value["t"]) is not int or not any(r["t"] == value["t"] and r["rat"] == value["rat"] for r in test["rows"]):
        raise ValueError("Issue must reference an observation in this Test ID.")
    fields = (test_id, value["t"], value["rat"], value["metric"], value["title"].strip(), value["note"].strip(), value["severity"])
    now = datetime.now(timezone.utc).isoformat()
    with connection(path) as db:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute("SELECT * FROM issues WHERE id=?", (issue_id,)).fetchone()
        if existing:
            if tuple(existing[k] for k in ("test_id", "t", "rat", "metric", "title", "note", "severity")) != fields:
                raise Conflict("This issue ID already identifies different content.")
        else:
            db.execute("INSERT INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?)", (issue_id, *fields, "open", now, now))
            audit_entry(db, test_id, "Issue opened", f"{issue_id} · {value['severity']} · {value['title'].strip()}")
    return workspace(path, test_id)


def set_issue_status(path, test_id, issue_id, status):
    if status not in ("open", "resolved"):
        raise ValueError("Issue status must be open or resolved.")
    with connection(path) as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT title,status FROM issues WHERE id=? AND test_id=?", (issue_id, test_id)).fetchone()
        if row is None:
            raise LookupError("Issue not found.")
        if row["status"] != status:
            db.execute("UPDATE issues SET status=?,updated=? WHERE id=?", (status, datetime.now(timezone.utc).isoformat(), issue_id))
            audit_entry(db, test_id, f"Issue {status}", f"{issue_id} · {row['title']}")
    return workspace(path, test_id)


def save_test(path, request_id, scope, label, notes, source, raw, *, demo_id=None):
    digest = hashlib.sha256(raw).hexdigest()
    kind = "synthetic" if demo_id else "imported"
    fields = (json.dumps(scope, ensure_ascii=False, sort_keys=True), label, notes, source, digest, kind)
    with connection(path) as db:
        existing = db.execute(f"SELECT {META} FROM tests WHERE request_id=?", (request_id,)).fetchone()
    if existing is None:
        rows = normalize(raw)
        packed = zlib.compress(json.dumps(rows, separators=(",", ":"), ensure_ascii=False).encode())
        test_id = demo_id or f"DT-{datetime.now(timezone.utc):%Y%m%d}-{uuid.uuid4().hex[:12].upper()}"
        with connection(path) as db:
            db.execute("""INSERT INTO tests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(request_id) DO NOTHING""",
                (test_id, request_id, *fields, datetime.now(timezone.utc).isoformat(),
                 rows[0]["t"], rows[-1]["t"], len(rows), packed))
            existing = db.execute(f"SELECT {META} FROM tests WHERE request_id=?", (request_id,)).fetchone()
    record = metadata(existing)
    same_scope = all(record["scope"][key] == scope[key] for key in ("region_id", "project_id", "task_id"))
    if not same_scope or tuple(existing[name] for name in ("label", "notes", "source", "sha256", "kind")) != fields[1:]:
        raise ValueError("This import attempt already identifies different content. Select the file again.")
    return record
