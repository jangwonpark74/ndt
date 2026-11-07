import importlib.util
from contextlib import closing
import errno
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server

spec = importlib.util.spec_from_file_location('extract_nyc_verizon', ROOT / 'scripts' / 'extract_nyc_verizon.py')
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


class RegionTests(unittest.TestCase):
    def test_migration_preserves_edits_and_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy = Path(directory) / 'old.sqlite3'
            destination = Path(directory) / 'regions.sqlite3'
            with closing(sqlite3.connect(legacy)) as source:
                source.execute('PRAGMA journal_mode=WAL')
                source.execute('CREATE TABLE project_sites (project_id TEXT, site_ids TEXT)')
                source.execute('INSERT INTO project_sites VALUES (?, ?)', ('harbourfront', '["site-1"]'))
                source.commit()
                self.assertTrue(server.migrate_database(legacy, destination))
                with closing(sqlite3.connect(destination)) as copied:
                    self.assertEqual(copied.execute('SELECT site_ids FROM project_sites').fetchone()[0], '["site-1"]')
                    copied.execute('UPDATE project_sites SET site_ids=?', ('["site-2"]',))
                    copied.commit()
                self.assertFalse(server.migrate_database(legacy, destination))
                self.assertEqual(source.execute('SELECT site_ids FROM project_sites').fetchone()[0], '["site-1"]')
            with closing(sqlite3.connect(destination)) as copied:
                self.assertEqual(copied.execute('SELECT site_ids FROM project_sites').fetchone()[0], '["site-2"]')
            self.assertEqual(list(Path(directory).glob('.regions-migration-*')), [])

    def test_missing_or_invalid_legacy_database(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy = Path(directory) / 'old.sqlite3'
            destination = Path(directory) / 'regions.sqlite3'
            self.assertFalse(server.migrate_database(legacy, destination))
            legacy.write_text('not a database')
            with self.assertRaises(sqlite3.DatabaseError):
                server.migrate_database(legacy, destination)
            self.assertFalse(destination.exists())
            self.assertEqual(list(Path(directory).glob('.regions-migration-*')), [])

    def test_custom_database_does_not_migrate_default(self):
        httpd = unittest.mock.MagicMock()
        httpd.__enter__.return_value = httpd
        httpd.server_address = ('127.0.0.1', 5179)
        with patch.object(sys, 'argv', ['server.py', '--db', '/tmp/custom-ndt.sqlite3']), \
             patch.object(server, 'bind_server', return_value=httpd), \
             patch.object(server, 'initialize') as initialize, \
             patch.object(server, 'migrate_database') as migrate:
            self.assertEqual(server.main(), 0)
            migrate.assert_not_called()
            initialize.assert_called_once_with(Path('/tmp/custom-ndt.sqlite3'))

    def test_default_database_is_in_project_directory(self):
        httpd = unittest.mock.MagicMock()
        httpd.__enter__.return_value = httpd
        httpd.server_address = ('127.0.0.1', 5179)
        with patch.object(sys, 'argv', ['server.py']), \
             patch.object(server, 'bind_server', return_value=httpd), \
             patch.object(server, 'initialize') as initialize, \
             patch.object(server, 'migrate_database', return_value=False) as migrate:
            self.assertEqual(server.main(), 0)
            self.assertEqual(server.DEFAULT_DB, ROOT.parent / 'regions.sqlite3')
            migrate.assert_called_once_with(ROOT / 'var' / 'regions.sqlite3', server.DEFAULT_DB)
            initialize.assert_called_once_with(server.DEFAULT_DB)

    def test_default_port_fallback_and_exact_port(self):
        in_use = OSError(errno.EADDRINUSE, 'in use')
        sentinel = object()
        with patch.object(server, 'ThreadingHTTPServer', side_effect=[in_use, sentinel]) as bind:
            self.assertIs(server.bind_server('127.0.0.1', None, object), sentinel)
            self.assertEqual([call.args[0][1] for call in bind.call_args_list], [5179, 5180])
        with patch.object(server, 'ThreadingHTTPServer', side_effect=OSError(errno.EADDRINUSE, 'in use')) as bind:
            with self.assertRaisesRegex(OSError, 'Port 5179 is already in use'):
                server.bind_server('127.0.0.1', 5179, object)
            self.assertEqual(bind.call_count, 1)
        with patch.object(server, 'ThreadingHTTPServer', side_effect=OSError(errno.EADDRINUSE, 'in use')) as bind:
            with self.assertRaisesRegex(OSError, 'All default ports 5179–5189'):
                server.bind_server('127.0.0.1', None, object)
            self.assertEqual(bind.call_count, 11)
        with patch.object(server, 'ThreadingHTTPServer', side_effect=OSError(errno.EACCES, 'denied')) as bind:
            with self.assertRaises(OSError) as caught:
                server.bind_server('127.0.0.1', None, object)
            self.assertEqual(caught.exception.errno, errno.EACCES)
            self.assertEqual(bind.call_count, 1)

    def test_sqlite_region_assets_and_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'regions.sqlite3'
            server.initialize(path)
            with sqlite3.connect(path) as db:
                regions = dict(db.execute('SELECT id, metadata FROM regions'))
                self.assertEqual(set(regions), {'toronto', 'new-york'})
                self.assertEqual(json.loads(regions['new-york'])['network'], 'nyc-poles')
                payload = db.execute('SELECT content FROM region_assets WHERE region_id=? AND path=?', ('new-york', 'verizon-poles.geojson')).fetchone()[0]
                poles = json.loads(payload)
                self.assertEqual(len(poles['features']), 701)
                self.assertTrue(all(f['properties']['franchisee'] == 'NY SMSA' for f in poles['features']))
                self.assertEqual(sum(f['properties'].get('status') == 'Installed' for f in poles['features']), 125)
                self.assertIsNone(db.execute('SELECT content FROM region_assets WHERE region_id=? AND path=?', ('toronto', 'verizon-poles.geojson')).fetchone())
                db.execute('INSERT INTO project_sites VALUES (?, ?, ?)', ('toronto', 'harbourfront', json.dumps(['example-site'])))
            server.initialize(path)
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('SELECT count(*) FROM regions').fetchone()[0], 2)
                self.assertEqual(db.execute('SELECT content FROM region_assets WHERE region_id=? AND path=?', ('new-york', 'verizon-poles.geojson')).fetchone()[0], payload)
                self.assertEqual(json.loads(db.execute('SELECT site_ids FROM project_sites WHERE region_id=? AND project_id=?', ('toronto', 'harbourfront')).fetchone()[0]), ['example-site'])

    def test_verizon_filter_preserves_reported_status(self):
        rows = [dict(id='1', franchisee='NY SMSA', longitude='-73.98', latitude='40.75', status='Proposed'),
                dict(id='2', franchisee='Crown Castle', longitude='-73.98', latitude='40.75'),
                dict(id='3', franchisee='NY SMSA', longitude='invalid', latitude='40.75')]
        features = extractor.convert(rows)['features']
        self.assertEqual(len(features), 1)
        self.assertEqual(features[0]['properties']['status'], 'Proposed')


if __name__ == '__main__':
    unittest.main()
