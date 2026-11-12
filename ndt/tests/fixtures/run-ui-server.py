"""Launch one owned UI server with a process identity for deterministic teardown."""
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend import server

original_handler = server.handler_for


def fixture_handler(db_path):
    class FixtureHandler(original_handler(db_path)):
        def do_GET(self):
            if self.path == '/__ndt_test_identity':
                body = json.dumps(dict(pid=os.getpid(), runId=os.environ['NDT_UI_RUN_ID'])).encode()
                return self.respond(body, 'application/json')
            return super().do_GET()
    return FixtureHandler

identity = Path(os.environ['NDT_UI_FIXTURE_DIR']) / 'server-process.json'
identity.write_text(json.dumps(dict(pid=os.getpid(), runId=os.environ['NDT_UI_RUN_ID'])), encoding='utf-8')
server.handler_for = fixture_handler
try:
    server.main()
finally:
    identity.unlink(missing_ok=True)
