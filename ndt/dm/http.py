"""DM HTTP adapter hosted by the NDT server on the same origin."""

import json
import sqlite3
import uuid
from urllib.parse import unquote, urlsplit
from .dm_model import (Conflict, ID, MAX_BYTES, get_test, list_tests, save_issue,
                       save_profile, save_test, set_issue_status, validate_profile)
from .integration import catalog
from .experiments import ExperimentStore, ExperimentWorker


def registry_path(app_root):
    current = app_root.parent / 'drive_tests.sqlite3'
    previous = app_root / 'var/tests.sqlite3'
    return previous if previous.is_file() and not current.exists() else current


class DriveTestService:
    def __init__(self, planning_db, tests_db):
        self.planning_db, self.tests_db = planning_db, tests_db
        self.store = ExperimentStore(tests_db, planning_db)
        self.worker = ExperimentWorker(self.store)

    def close(self):
        self.worker.close()


def plain(value, name, maximum, required=False):
    if not isinstance(value, str):
        raise ValueError(f"{name} must be text.")
    value = value.strip()
    if len(value) > maximum or (required and not value) or any(ord(ch) < 32 for ch in value):
        raise ValueError(f"{name} must be plain text of {'1–' if required else 'up to '}{maximum} characters.")
    return value

class DriveTestAPI:
    def dm_path(self):
        return '/api/' + urlsplit(self.path).path.removeprefix('/api/dm/')

    def handle_dm(self, method):
        if not urlsplit(self.path).path.startswith('/api/dm/'):
            return False
        service = self.server.drive_service
        self.dm_db, self.planning_db = service.tests_db, service.planning_db
        self.dm_store = service.store
        if method in ('GET', 'POST', 'PUT', 'PATCH'):
            getattr(self, 'dm_' + method)()
        else:
            self.dm_json(405, {'error': 'Unsupported drive-test operation.'})
        return True

    def dm_GET(self):
        if not self.dm_local():
            return
        path = self.dm_path()
        try:
            if path == '/api/tests':
                return self.dm_json(200, list_tests(self.dm_db))
            if path == '/api/catalog':
                return self.dm_json(200, catalog(self.planning_db))
            if path == '/api/experiments':
                return self.dm_json(200, self.dm_store.list())
            if path.startswith('/api/experiments/'):
                return self.dm_json(200, self.dm_store.get(path.removeprefix('/api/experiments/')))
            if path.startswith('/api/tests/'):
                identity = path.removeprefix('/api/tests/')
                test = get_test(self.dm_db, identity) if ID.fullmatch(identity) else None
                if test:
                    return self.dm_json(200, test)
            return self.dm_json(404, {'error': 'Drive-test resource not found.'})
        except LookupError as error:
            self.dm_json(404, {'error': str(error)})
        except (OSError, sqlite3.Error):
            self.dm_json(503, {'error': 'Drive-test storage is unavailable. Retry loading.'})

    def dm_experiment_post(self, path):
        if self.headers.get_content_type() != 'application/json':
            return self.dm_json(415, {'error': 'Send application/json.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 16384:
                return self.dm_json(413, {'error': 'Experiment updates must be 1 byte to 16 KiB.'})
            raw = self.rfile.read(size)
            if len(raw) != size:
                raise ValueError('The request ended early. Retry the same submission.')
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError('Provide a JSON object.')
            if path == '/api/experiments':
                if set(value) != {'request_id', 'spec'}:
                    raise ValueError('Provide request_id and spec.')
                result = self.dm_store.submit(value['request_id'], value['spec'])
                self.server.drive_service.worker.wake.set()
            elif path.endswith('/cancel') and path.startswith('/api/experiments/'):
                result = self.dm_store.cancel(path.split('/')[3])
            elif path.endswith('/route-associations') and path.startswith('/api/tests/'):
                result = self.dm_store.associate(path.split('/')[3], value)
            elif path == '/api/comparisons':
                if set(value) not in ({'a_id', 'b_id', 'metric', 'profile'},{'a_id', 'b_id', 'metric', 'profile','rat'}):
                    raise ValueError('Provide both Test IDs, the metric and the evaluation profile.')
                result = self.dm_store.compare(value['a_id'], value['b_id'], value['metric'], validate_profile(value['profile']),rat=value.get('rat','all'))
            else:
                return self.dm_json(404, {'error': 'Drive-test resource not found.'})
            self.dm_json(200, result)
        except Conflict as error:
            self.dm_json(409, {'error': str(error)})
        except LookupError as error:
            self.dm_json(404, {'error': str(error)})
        except (ValueError, TypeError, KeyError, UnicodeError, TimeoutError) as error:
            self.dm_json(400, {'error': str(error) or 'Invalid experiment request.'})
        except (OSError, sqlite3.Error):
            self.dm_json(503, {'error': 'The operation could not be saved. Retry the same submission.'})


    def dm_respond(self, code, data, content_type):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(data)

    def dm_json(self, code, payload):
        self.dm_respond(code, json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode(),
                     "application/json; charset=utf-8")

    def dm_local(self):
        port = self.server.server_port
        host = self.headers.get("Host")
        if host not in {f"127.0.0.1:{port}", f"localhost:{port}"}:
            self.dm_json(403, {"error": "Open the app from its localhost URL."})
            return False
        origin = self.headers.get("Origin")
        if self.headers.get("Sec-Fetch-Site") == "cross-site" or (origin and origin != f"http://{host}"):
            self.dm_json(403, {"error": "Cross-origin requests are blocked."})
            return False
        return True

    def dm_POST(self):
        if not self.dm_local():
            return
        path = self.dm_path()
        if path == '/api/experiments' or path == '/api/comparisons' or path.endswith(('/cancel', '/route-associations')):
            return self.dm_experiment_post(path)
        if path.endswith("/issues"):
            return self.dm_mutate_workspace("issue")
        if path != "/api/tests":
            return self.dm_json(404, {"error": "Resource not found."})
        if self.headers.get_content_type() != "text/csv":
            return self.dm_json(415, {"error": "Upload a UTF-8 CSV file."})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BYTES:
                return self.dm_json(413, {"error": "Upload size must be between 1 byte and 16 MiB."})
            ids = [self.headers.get(f"X-DM-{field}", "") for field in ("Region", "Project", "Task")]
            if not all(ID.fullmatch(value) for value in ids):
                raise ValueError("Region, Project and Task IDs need 1–64 letters, digits, underscores or hyphens.")
            request_id = str(uuid.UUID(self.headers.get("X-DM-Request", "")))
            label = plain(unquote(self.headers.get("X-DM-Label", "")), "Run name", 100, True)
            notes = plain(unquote(self.headers.get("X-DM-Notes", "")), "Capture notes", 500)
            source = plain(unquote(self.headers.get("X-DM-Source", "")), "File name", 200, True)
            data = self.rfile.read(size)
            if len(data) != size:
                raise ValueError("The upload ended early. Retry the same import.")
            entry = next((t for t in catalog(self.planning_db)['tasks'] if [t[k] for k in ('region_id','project_id','task_id')] == ids), None)
            scope = {k: entry[k] for k in ('region_id','region','project_id','project','task_id','task')} if entry else dict(zip(('region_id','project_id','task_id'), ids))
            for key in ('region','project','task'):
                scope.setdefault(key, scope[key+'_id'])
            result = save_test(self.dm_db, request_id, scope, label, notes, source, data)
            self.dm_json(201, result)
        except (ValueError, TimeoutError) as exc:
            self.dm_json(400, {"error": str(exc) or "The upload timed out."})
        except (OSError, sqlite3.Error):
            self.dm_json(500, {"error": "The run could not be saved. Retry the same import."})

    def dm_PUT(self):
        if self.dm_local():
            self.dm_mutate_workspace("profile")

    def dm_PATCH(self):
        if self.dm_local():
            self.dm_mutate_workspace("status")

    def dm_mutate_workspace(self, action):
        parts = self.dm_path().strip("/").split("/")
        tail = "profile" if action == "profile" else "issues"
        if len(parts) != (5 if action == "status" else 4) or parts[:2] != ["api", "tests"] or parts[3] != tail or not ID.fullmatch(parts[2]):
            return self.dm_json(404, {"error": "Resource not found."})
        if self.headers.get_content_type() != "application/json":
            return self.dm_json(415, {"error": "Send application/json."})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 16384:
                return self.dm_json(413, {"error": "Workspace updates must be between 1 byte and 16 KiB."})
            value = json.loads(self.rfile.read(size))
            if not isinstance(value, dict):
                raise ValueError("Workspace update must be a JSON object.")
            if action == "profile":
                if set(value) != {"revision", "profile"}:
                    raise ValueError("Provide the profile and workspace revision.")
                result = save_profile(self.dm_db, parts[2], value["revision"], value["profile"])
            elif action == "issue":
                result = save_issue(self.dm_db, parts[2], value)
            else:
                if set(value) != {"status"}:
                    raise ValueError("Provide the issue status.")
                result = set_issue_status(self.dm_db, parts[2], parts[4], value["status"])
            self.dm_json(200, result)
        except Conflict as exc:
            self.dm_json(409, {"error": str(exc)})
        except LookupError as exc:
            self.dm_json(404, {"error": str(exc)})
        except (ValueError, UnicodeError, TimeoutError) as exc:
            self.dm_json(400, {"error": str(exc) or "The request timed out."})
        except (OSError, sqlite3.Error):
            self.dm_json(500, {"error": "The update could not be saved. Retry the same update."})
