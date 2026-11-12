"""Scenario revisions are immutable, scoped and protected against stale writes."""
from contextlib import closing
import copy
import json
import http.client
import threading
from pathlib import Path
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend import server
from backend.task_store import connect
from backend.radio_scenarios import save_scenario, list_scenarios, ScenarioConflict

TEMPLATE = dict(rat='NR', frequencyMHz=3500, bandwidthMHz=100, powerDbm=40,
                gainDbi=8, lossDb=2, tiltDeg=6, azimuthDeg=0, pattern='element', mode='NLOS')


class RadioScenarios(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'planning.sqlite3'
        server.initialize(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def save(self, **changes):
        body = dict(id='study-1', name='NR baseline', expectedRevision=0, action='save', template=TEMPLATE, overrides={})
        body.update(changes)
        with closing(connect(self.path)) as db, db:
            return save_scenario(db, 'toronto', 'harbourfront', body)

    def test_durable_revisions_pointers_and_frozen_source(self):
        first = self.save()
        self.assertEqual(first['revision'], 1)
        self.assertIsNone(first['appliedRevision'])
        self.assertTrue(first['versions'][0]['sourceFingerprint'])
        self.save(action='baseline', expectedRevision=1)
        self.save(action='apply', expectedRevision=1)
        second = self.save(expectedRevision=1, template={**TEMPLATE, 'tiltDeg': 12})
        self.assertEqual(second['revision'], 2)
        self.assertEqual(second['baselineRevision'], 1)
        self.assertEqual(second['appliedRevision'], 1)
        self.assertEqual(second['versions'][0]['template']['tiltDeg'], 6)
        self.assertEqual(second['versions'][1]['template']['tiltDeg'], 12)
        server.initialize(self.path)
        with closing(connect(self.path)) as db:
            saved = list_scenarios(db, 'toronto', 'harbourfront')
            self.assertEqual(saved, [second])
            self.assertEqual(list_scenarios(db, 'toronto', 'northyork'), [])

    def test_stale_save_apply_and_baseline_cannot_overwrite(self):
        self.save()
        for action in ('save', 'apply', 'baseline'):
            with self.assertRaises(ScenarioConflict):
                self.save(action=action, expectedRevision=0)
        self.assertEqual(self.save(expectedRevision=1)['revision'], 2)

    def test_invalid_input_and_unknown_sites_leave_saved_version_intact(self):
        self.save()
        for changes in ({'template': {**TEMPLATE, 'frequencyMHz': None}},
                        {'template': {**TEMPLATE, 'powerDbm': True}},
                        {'template': {**TEMPLATE, 'pattern': 'isotropic'}},
                        {'overrides': {'invented-site': TEMPLATE}},
                        {'expectedRevision': True}, {'name': ''}):
            with self.assertRaises(ValueError):
                self.save(**{'expectedRevision': 1, **changes})
        with closing(connect(self.path)) as db:
            self.assertEqual(list_scenarios(db, 'toronto', 'harbourfront')[0]['revision'], 1)

    def test_site_override_and_fingerprint_are_frozen_per_revision(self):
        with closing(connect(self.path)) as db:
            site = db.execute("SELECT site_id FROM network_sites WHERE region_id='toronto' LIMIT 1").fetchone()[0]
        first = self.save(overrides={site: {**TEMPLATE, 'azimuthDeg': 120}})
        with closing(connect(self.path)) as db, db:
            db.execute("UPDATE regions SET fingerprint='new-source' WHERE id='toronto'")
        second = self.save(expectedRevision=1)
        self.assertEqual(first['versions'][0], second['versions'][0])
        self.assertEqual(second['versions'][1]['sourceFingerprint'], 'new-source')

    def test_parallel_writers_have_exactly_one_winner(self):
        self.save()
        def write(tilt):
            try:
                self.save(expectedRevision=1, template={**TEMPLATE, 'tiltDeg': tilt})
                return 'saved'
            except ScenarioConflict:
                return 'conflict'
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(write, [8, 12])), ['conflict', 'saved'])

    def test_changed_source_cannot_be_applied_without_a_new_revision(self):
        self.save()
        with closing(connect(self.path)) as db, db:
            db.execute("UPDATE regions SET fingerprint='new-source' WHERE id='toronto'")
        with self.assertRaisesRegex(ValueError, 'inventory changed'):
            self.save(expectedRevision=1, action='apply')
        self.save(expectedRevision=1)
        self.assertEqual(self.save(expectedRevision=2, action='apply')['appliedRevision'], 2)

    def test_http_conflict_validation_origin_and_project_isolation(self):
        httpd = server.ViewerHTTPServer(('127.0.0.1', 0), server.handler_for(self.path))
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        url = '/api/regions/toronto/projects/harbourfront/radio-scenarios'
        def request(method, path=url, payload=None, headers=None):
            with closing(http.client.HTTPConnection('127.0.0.1', httpd.server_port, timeout=10)) as client:
                client.request(method, path, json.dumps(payload) if payload else None,
                               {'Content-Type': 'application/json', **(headers or {})})
                response = client.getresponse()
                return response.status, json.loads(response.read())
        try:
            self.assertEqual(request('GET'), (200, []))
            body = dict(id='http-study', name='HTTP study', expectedRevision=0, action='save', template=TEMPLATE, overrides={})
            self.assertEqual(request('PUT', payload=body)[0], 200)
            self.assertEqual(request('PUT', payload=body)[0], 409)
            self.assertEqual(request('PUT', payload={**body, 'expectedRevision': 1, 'template': {}})[0], 400)
            self.assertEqual(request('PUT', payload=body, headers={'Origin': 'https://malicious.invalid'})[0], 403)
            self.assertEqual(request('GET', path=url.replace('harbourfront', 'missing'))[0], 404)
            self.assertEqual(request('GET', path=url.replace('harbourfront', 'northyork')), (200, []))
        finally:
            httpd.shutdown()
            httpd.server_close()


if __name__ == '__main__':
    unittest.main()
