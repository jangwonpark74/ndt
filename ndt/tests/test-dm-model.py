import concurrent.futures
import os
from copy import deepcopy
from contextlib import closing
import sqlite3
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

from dm.demo import DEMO_SCOPE, demo_csv, seed
from dm.dm_model import (Conflict, DEFAULT_PROFILE, get_test, initialize, list_tests, normalize,
                      save_issue, save_profile, save_test, set_issue_status, validate_profile)


class TestRegistry(unittest.TestCase):
    @unittest.skipIf(os.name == 'nt', 'POSIX mode bits do not represent Windows ACLs')
    def test_new_capture_registry_is_private(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'private.sqlite3'
            initialize(path)
            self.assertEqual(path.stat().st_mode&0o777,0o600)

    def test_legacy_kind_constraint_upgrade_keeps_capture_profiles_issues_and_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'legacy.sqlite3'
            initialize(path)
            seed(path)
            test = get_test(path, 'DT-DEMO-002')
            save_profile(path, test['id'], 0, DEFAULT_PROFILE)
            row = test['rows'][0]
            save_issue(path, test['id'], dict(id='20a1af4c-42b9-4e97-adcc-5210ef5fd956',t=row['t'],rat=row['rat'],
                metric='rsrp_dbm',title='Legacy finding',note='Retain during migration',severity='medium'))
            # Recreate the previous origin constraint with existing child tables and payloads.
            with closing(sqlite3.connect(path)) as db, db:
                sql = db.execute("SELECT sql FROM sqlite_master WHERE name='tests'").fetchone()[0]
                db.execute(sql.replace('CREATE TABLE tests', 'CREATE TABLE tests_old_kind').replace(",\x27simulated\x27", ''))
                db.execute('INSERT INTO tests_old_kind SELECT * FROM tests')
                db.execute('DROP TABLE tests')
                db.execute('ALTER TABLE tests_old_kind RENAME TO tests')
            initialize(path)
            after = get_test(path, test['id'])
            self.assertEqual(after['rows'], test['rows'])
            self.assertEqual(after['sha256'], test['sha256'])
            self.assertEqual(after['revision'], 1)
            self.assertEqual(after['issues'][0]['title'], 'Legacy finding')
            self.assertEqual(len(after['audit']), 2)
            with closing(sqlite3.connect(path)) as db, db:
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
                self.assertIn("'simulated'", db.execute("SELECT sql FROM sqlite_master WHERE name='tests'").fetchone()[0])

    def test_profile_persistence_conflict_and_non_destructive_upgrade(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / 'runs.sqlite3'
            initialize(db)
            seed(db)
            before = get_test(db, 'DT-DEMO-002')
            profile = deepcopy(DEFAULT_PROFILE)
            profile['thresholds']['rsrp_dbm']['NR'] = -100
            saved = save_profile(db, before['id'], 0, profile)
            self.assertEqual(saved['revision'], 1)
            self.assertEqual(saved['audit'][0]['action'], 'Profile saved')
            self.assertEqual(saved['audit'][0]['profile'], profile)
            with self.assertRaises(Conflict):
                save_profile(db, before['id'], 0, DEFAULT_PROFILE)
            initialize(db)
            after = get_test(db, before['id'])
            self.assertEqual(after['profile'], profile)
            self.assertEqual(after['rows'], before['rows'])
            self.assertEqual(after['sha256'], before['sha256'])
            self.assertEqual(get_test(db, 'DT-DEMO-001')['revision'], 0)
            with self.assertRaises(LookupError):
                save_profile(db, 'missing', 0, profile)

    def test_profile_boundary_validation(self):
        for key, bad in [('gap', 0), ('minSamples', 1.5), ('minSamples', True),
                         ('minCoveragePct', float('nan')), ('minGpsPct', -1),
                         ('maxFailPct', 101), ('name', '\nname')]:
            value = deepcopy(DEFAULT_PROFILE)
            value[key] = bad
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_profile(value)
        for bad in (None, [], {'thresholds': {}}, {**DEFAULT_PROFILE, 'extra': 1}):
            with self.assertRaises(ValueError):
                validate_profile(bad)
        value = deepcopy(DEFAULT_PROFILE)
        value['thresholds']['latency_ms']['NR'] = -1
        with self.assertRaises(ValueError):
            validate_profile(value)

    def test_issue_idempotency_sample_binding_and_audit(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / 'runs.sqlite3'
            initialize(db)
            seed(db)
            sample = get_test(db, 'DT-DEMO-002')['rows'][0]
            issue = dict(id='20a1af4c-42b9-4e97-adcc-5210ef5fd956', t=sample['t'], rat=sample['rat'],
                         metric='rsrp_dbm', title='Tunnel exit', note='Verify on site\nSecond pass', severity='high')
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
                results = list(pool.map(lambda _: save_issue(db, 'DT-DEMO-002', issue), range(3)))
            self.assertTrue(all(len(r['issues']) == 1 for r in results))
            self.assertEqual(len(results[-1]['audit']), 1)
            resolved = set_issue_status(db, 'DT-DEMO-002', issue['id'], 'resolved')
            self.assertEqual(resolved['issues'][0]['status'], 'resolved')
            again = set_issue_status(db, 'DT-DEMO-002', issue['id'], 'resolved')
            self.assertEqual(len(again['audit']), 2)
            with self.assertRaises(Conflict):
                save_issue(db, 'DT-DEMO-002', {**issue, 'title': 'Changed retry'})
            with self.assertRaises(ValueError):
                save_issue(db, 'DT-DEMO-002', {**issue, 't': sample['t'] - 1})
            with self.assertRaises(LookupError):
                set_issue_status(db, 'DT-DEMO-001', issue['id'], 'open')
            self.assertEqual(get_test(db, 'DT-DEMO-001')['issues'], [])

    def test_import_validates_and_normalizes_atomically(self):
        header = b'timestamp,latitude,longitude,rat,rsrp_dbm,pci\n'
        good = b'2026-11-10T09:00:01+09:00,,,5G,-98,702\n2026-11-10T00:00:00Z,43.6,-79.3,LTE,-109,48\n'
        rows = normalize(header + good)
        self.assertEqual([r['rat'] for r in rows], ['LTE', 'NR'])
        self.assertEqual(rows[1]['t'] - rows[0]['t'], 1000)
        self.assertNotIn('latitude', rows[1])
        for bad in (good.splitlines()[0], b'2026-11-10T00:00:02Z,43.6,,NR,-93,481',
                    b'2026-11-10T00:00:02Z,43.6,-79.3,LTE,nan,100',
                    b'2026-11-10T00:00:02Z,43.6,-79.3,LTE,-98,504'):
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, 'Line 4'):
                normalize(header + good + bad + b'\n')

    def test_concurrent_retry_and_distinct_execution_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / 'runs.sqlite3'
            initialize(db)
            seed(db)
            seed(db)
            def save(request):
                return save_test(db, request, DEMO_SCOPE, 'Capture', '', 'test.csv', demo_csv(True))
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                ids = {result['id'] for result in pool.map(save, ['request'] * 4)}
            self.assertEqual(len(ids), 1)
            new = save('request-2')
            self.assertNotIn(new['id'], ids)
            self.assertEqual(len(list_tests(db)), 4)
            self.assertEqual(len(get_test(db, new['id'])['rows']), 481)
            with self.assertRaisesRegex(ValueError, 'different content'):
                save_test(db, 'request', DEMO_SCOPE, 'Different', '', 'test.csv', demo_csv(True))
            with self.assertRaises(ValueError):
                save_test(db, 'bad-request', DEMO_SCOPE, 'Bad', '', 'test.csv', b'wrong')
            with closing(sqlite3.connect(db)) as conn:
                self.assertEqual(conn.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                self.assertEqual(conn.execute('SELECT count(*) FROM tests').fetchone()[0], 4)


if __name__ == '__main__':
    unittest.main()
