"""Same-origin DM API and application mounting integration checks."""
from contextlib import closing
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from dm.http import DriveTestService


class DriveHTTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.planning = Path(cls.temp.name) / 'planning.sqlite3'
        server.initialize(cls.planning)
        cls.httpd = server.ViewerHTTPServer(('127.0.0.1', 0), server.handler_for(cls.planning))
        cls.httpd.drive_service = DriveTestService(cls.planning, Path(cls.temp.name) / 'tests.sqlite3')
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.drive_service.close()
        cls.httpd.server_close()
        cls.temp.cleanup()

    def request(self, method, path, body=None, headers=None):
        with closing(http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=20)) as client:
            data = json.dumps(body) if body is not None else None
            client.request(method, path, data, {'Content-Type': 'application/json', **(headers or {})})
            response = client.getresponse()
            return response.status, response.read(), response.getheader('Content-Type')

    def test_workspace_is_self_contained_and_catalog_uses_the_served_database(self):
        code, data, mime = self.request('GET', '/drive-test/')
        self.assertEqual(code, 200)
        self.assertIn(b'CongitV NDT', data)
        self.assertIn(b'./app.js', data)
        code, data, mime = self.request('GET', '/api/dm/catalog')
        self.assertEqual(code, 200)
        self.assertGreater(len(json.loads(data)['regions']), 0)
        self.assertEqual(self.request('GET', '/drive-test/test-view-model.mjs')[0], 200)

    def test_same_origin_guard_and_unknown_paths(self):
        for headers in ({'Host': 'malicious.invalid'}, {'Origin': 'https://malicious.invalid'}, {'Sec-Fetch-Site': 'cross-site'}):
            self.assertEqual(self.request('POST', '/api/dm/experiments', {}, headers)[0], 403)
        self.assertEqual(self.request('GET', '/api/dm/not-found')[0], 404)
        self.assertEqual(self.request('POST', '/api/dm/experiments', {})[0], 400)


if __name__ == '__main__':
    unittest.main()
