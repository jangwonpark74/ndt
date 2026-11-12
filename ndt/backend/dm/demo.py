"""Reproducible synthetic Harbourfront observations for the example Test IDs."""
import csv
import io
import math
from datetime import datetime, timedelta, timezone

from .dm_model import COLUMNS, get_test, save_test

DEMO_SCOPE = {
    "region_id": "toronto", "region": "Toronto", "project_id": "harbourfront",
    "project": "Harbourfront", "task_id": "DM-DEMO", "task": "Waterfront mobility survey",
}
WAYPOINTS = [
    (-79.39472, 43.64036), (-79.39270, 43.64058), (-79.38763, 43.64085),
    (-79.38451, 43.64227), (-79.38204, 43.64294), (-79.38142, 43.64409),
    (-79.38373, 43.64529), (-79.38626, 43.64413), (-79.38907, 43.64310),
    (-79.39289, 43.64155), (-79.39472, 43.64036),
]


def demo_csv(candidate):
    result = io.StringIO()
    writer = csv.DictWriter(result, fieldnames=COLUMNS)
    writer.writeheader()
    start = datetime(2026, 11, 9 if candidate else 8, 14, 10, tzinfo=timezone.utc)
    for i in range(481):
        leg = min(i // 48, len(WAYPOINTS) - 2)
        share = (i - leg * 48) / 48
        a, b = WAYPOINTS[leg:leg + 2]
        lng, lat = [round(x + share * (y - x), 7) for x, y in zip(a, b)]
        nr = i < 158 or i >= 212
        rat = "NR" if nr else "LTE"
        fade = 28 * math.exp(-((i - 112) / 15) ** 2)
        fade += (18 if candidate else 27) * math.exp(-((i - 335) / 20) ** 2)
        fade += 10 * math.exp(-((i - 440) / 17) ** 2)
        rsrp = (-85 if nr else -94) + (3 if candidate else 0) - fade + 3.6 * math.sin(i / 19) + 1.4 * math.sin(i * 1.15)
        sinr = (21 if nr else 13) - 0.63 * fade + 4 * math.sin(i / 12)
        pci = [412, 267, 318, 197, 412][(i // 96) % 5] if nr else 181
        event = {0: "Throughput session started", 158: "LTE fallback logged",
                 212: "NR serving logged", 480: "Throughput session ended"}.get(i, "")
        if not candidate and i == 336:
            event = "Application stall logged"
        writer.writerow({
            "timestamp": (start + timedelta(seconds=i)).isoformat().replace("+00:00", "Z"),
            "latitude": "" if 256 <= i <= 263 else lat, "longitude": "" if 256 <= i <= 263 else lng,
            "rat": rat, "band": "n78" if nr else "B7", "pci": pci,
            "arfcn": 640128 if nr else 3100, "cell_id": f"{'N' if nr else 'E'}-{pci}",
            "rsrp_dbm": round(rsrp, 1), "rsrq_db": round(-9 - fade * 0.31 + math.sin(i / 7), 1),
            "sinr_db": round(sinr, 1), "dl_mbps": round(max(2, (175 if nr else 64) + 21 * math.sin(i / 9) - fade * 5), 1),
            "ul_mbps": round(max(1, (30 if nr else 17) + 5 * math.cos(i / 11) - fade), 1),
            "latency_ms": round(19 + (0 if nr else 11) + fade * 2.2 + abs(3 * math.sin(i)), 1),
            "event": event,
        })
    return result.getvalue().encode()


def seed(path):
    for number, label in [(1, "Morning baseline"), (2, "Tuning verification")]:
        test_id = f"DT-DEMO-{number:03}"
        if get_test(path, test_id) is None:
            save_test(path, test_id, DEMO_SCOPE, label,
                      "Synthetic single-device trace for replay and KPI demonstration.", f"{test_id}.csv",
                      demo_csv(number == 2), demo_id=test_id)
