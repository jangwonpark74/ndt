import importlib.util
from contextlib import closing
import errno
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server

spec = importlib.util.spec_from_file_location('extract_nyc_verizon', ROOT / 'scripts' / 'extract_nyc_verizon.py')
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


class RegionTests(unittest.TestCase):
    def test_nyc_extractor_reads_utf8_with_legacy_locale(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'input.json', Path(directory) / 'output.json'
            source.write_text(json.dumps([{'franchisee': 'NY SMSA', 'longitude': -73.9,
                'latitude': 40.7, 'on_street': '\u6f22 street'}], ensure_ascii=False), encoding='utf-8')
            env = dict(os.environ, PYTHONUTF8='0')
            subprocess.run([sys.executable, str(ROOT / 'scripts' / 'extract_nyc_verizon.py'),
                            str(source), str(output)], env=env, check=True, capture_output=True)
            data = json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(data['features'][0]['properties']['on_street'], '\u6f22 street')

    def test_virtual_ues_are_validated_isolated_and_persistent(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'regions.sqlite3'
            server.initialize(path)
            handler_type = server.handler_for(path)
            handler = handler_type.__new__(handler_type)
            handler.respond, handler.send_error = Mock(), Mock()
            base = '/api/regions/toronto/projects/northyork/virtual-ues'
            def put(payload, url=base + '/ue-1'):
                body = json.dumps(payload).encode()
                handler.path, handler.headers, handler.rfile = url, {'Content-Length':str(len(body))}, io.BytesIO(body)
                handler.send_error.reset_mock()
                handler.do_PUT()
            ue = {'name':'Test UE', 'longitude':-79.4, 'latitude':43.7}
            put(ue)
            handler.send_error.assert_not_called()
            put({'name':'NY UE', 'longitude':-73.9, 'latitude':40.7}, '/api/regions/new-york/projects/manhattan/virtual-ues/ue-1')
            handler.send_error.assert_not_called()
            for invalid in ({**ue, 'latitude':91}, {**ue, 'longitude':True}, {**ue, 'name':'  '}, {**ue, 'longitude':float('nan')}, {**ue, 'extra':1}):
                put(invalid)
                handler.send_error.assert_called_once()
                self.assertEqual(handler.send_error.call_args.args[0], 400)
            put(ue, base + '/bad%20id')
            handler.send_error.assert_called_once()
            self.assertEqual(handler.send_error.call_args.args[0], 400)
            put(ue, '/api/regions/toronto/projects/unknown/virtual-ues/ue-1')
            handler.send_error.assert_called_once_with(404)
            server.initialize(path)
            handler.path = base
            handler.do_GET()
            self.assertEqual(json.loads(handler.respond.call_args.args[0]), [{'id':'ue-1', **ue}])
            handler.path = base + '/ue-1'
            handler.do_DELETE()
            handler.send_error.reset_mock()
            handler.do_DELETE()
            handler.send_error.assert_not_called()
            handler.path = base
            handler.do_GET()
            self.assertEqual(json.loads(handler.respond.call_args.args[0]), [])
            handler.path = '/api/regions/new-york/projects/manhattan/virtual-ues'
            handler.do_GET()
            self.assertEqual(json.loads(handler.respond.call_args.args[0])[0]['name'], 'NY UE')

    def test_project_use_cases_are_validated_isolated_and_persistent(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'regions.sqlite3'
            server.initialize(path)
            handler = server.handler_for(path).__new__(server.handler_for(path))
            handler.respond, handler.send_error = Mock(), Mock()
            def put(value, project='northyork', region='toronto'):
                handler.path = f'/api/regions/{region}/projects/{project}/use-case'
                payload = json.dumps({'useCase':value}).encode()
                handler.headers = {'Content-Length':str(len(payload))}
                handler.rfile = io.BytesIO(payload)
                handler.send_error.reset_mock()
                handler.do_PUT()
            for value in ('virtual-drive-test', 'parameter-ab-test', 'ai-ran-benchmark'):
                put(value)
                handler.send_error.assert_not_called()
                self.assertEqual(json.loads(handler.respond.call_args.args[0]), {'useCase':value})
            for invalid in ('bad', [], {}, True, 1):
                put(invalid)
                self.assertEqual(handler.send_error.call_args.args[0], 400)
            put('parameter-ab-test', 'manhattan', 'new-york')
            handler.send_error.assert_not_called()
            put('virtual-drive-test', 'unknown')
            handler.send_error.assert_called_with(404)
            server.initialize(path)
            handler.path = '/api/regions/toronto/project-use-cases'
            handler.do_GET()
            self.assertEqual(json.loads(handler.respond.call_args.args[0]), {'northyork':'ai-ran-benchmark'})
            handler.path = '/api/regions/new-york/project-use-cases'
            handler.do_GET()
            self.assertEqual(json.loads(handler.respond.call_args.args[0]), {'manhattan':'parameter-ab-test'})
            put(None)
            handler.send_error.assert_not_called()
            handler.path = '/api/regions/toronto/project-use-cases'
            handler.do_GET()
            self.assertEqual(json.loads(handler.respond.call_args.args[0]), {})
            with closing(server.connect(path)) as db:
                self.assertEqual(db.execute('SELECT count(*) FROM drive_tasks').fetchone()[0], 0)
                self.assertEqual(db.execute('SELECT count(*) FROM project_sites').fetchone()[0], 0)
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

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
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(sys, 'argv', ['server.py', '--db', str(Path(directory) / 'custom-ndt.sqlite3')]), \
             patch.object(server, 'bind_server', return_value=httpd), \
             patch.object(server, 'initialize') as initialize, \
             patch.object(server, 'DriveTestService') as drive_service, \
             patch.object(server, 'migrate_database') as migrate:
            self.assertEqual(server.main(), 0)
            migrate.assert_not_called()
            initialize.assert_called_once_with(Path(directory) / 'custom-ndt.sqlite3')
            drive_service.assert_called_once_with(Path(directory) / 'custom-ndt.sqlite3', Path(directory) / 'drive_tests.sqlite3')

    def test_default_database_is_in_project_directory(self):
        httpd = unittest.mock.MagicMock()
        httpd.__enter__.return_value = httpd
        httpd.server_address = ('127.0.0.1', 5179)
        with patch.object(sys, 'argv', ['server.py']), \
             patch.object(server, 'bind_server', return_value=httpd), \
             patch.object(server, 'initialize') as initialize, \
             patch.object(server, 'DriveTestService') as drive_service, \
             patch.object(server, 'migrate_database', return_value=False) as migrate:
            self.assertEqual(server.main(), 0)
            self.assertEqual(server.DEFAULT_DB, ROOT.parent / 'regions.sqlite3')
            migrate.assert_called_once_with(ROOT / 'var' / 'regions.sqlite3', server.DEFAULT_DB)
            initialize.assert_called_once_with(server.DEFAULT_DB)

    def test_default_port_fallback_and_exact_port(self):
        in_use = OSError(errno.EADDRINUSE, 'in use')
        sentinel = object()
        with patch.object(server, 'ViewerHTTPServer', side_effect=[in_use, sentinel]) as bind:
            self.assertIs(server.bind_server('127.0.0.1', None, object), sentinel)
            self.assertEqual([call.args[0][1] for call in bind.call_args_list], [5179, 5180])
        with patch.object(server, 'ViewerHTTPServer', side_effect=OSError(errno.EADDRINUSE, 'in use')) as bind:
            with self.assertRaisesRegex(OSError, 'Port 5179 is already in use'):
                server.bind_server('127.0.0.1', 5179, object)
            self.assertEqual(bind.call_count, 1)
        with patch.object(server, 'ViewerHTTPServer', side_effect=OSError(errno.EADDRINUSE, 'in use')) as bind:
            with self.assertRaisesRegex(OSError, 'All default ports 5179–5189'):
                server.bind_server('127.0.0.1', None, object)
            self.assertEqual(bind.call_count, 11)
        with patch.object(server, 'ViewerHTTPServer', side_effect=OSError(errno.EACCES, 'denied')) as bind:
            with self.assertRaises(OSError) as caught:
                server.bind_server('127.0.0.1', None, object)
            self.assertEqual(caught.exception.errno, errno.EACCES)
            self.assertEqual(bind.call_count, 1)

    def test_sqlite_region_assets_and_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'regions.sqlite3'
            server.initialize(path)
            with closing(sqlite3.connect(path)) as db, db:
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
            with closing(sqlite3.connect(path)) as db, db:
                self.assertEqual(db.execute('SELECT count(*) FROM regions').fetchone()[0], 2)
                self.assertEqual(db.execute('SELECT content FROM region_assets WHERE region_id=? AND path=?', ('new-york', 'verizon-poles.geojson')).fetchone()[0], payload)
                self.assertEqual(json.loads(db.execute('SELECT site_ids FROM project_sites WHERE region_id=? AND project_id=?', ('toronto', 'harbourfront')).fetchone()[0]), ['example-site'])

    def test_network_records_preserve_source_and_serve_database_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'regions.sqlite3'
            server.initialize(path)
            with closing(sqlite3.connect(path)) as db, db:
                for region, dataset, count in [('toronto', 'bell-outdoor-sites.geojson', 1481),
                                               ('toronto', 'telus-sites.geojson', 60),
                                               ('new-york', 'verizon-poles.geojson', 701)]:
                    source = json.loads(db.execute('SELECT content FROM region_assets WHERE region_id=? AND path=?', (region, dataset)).fetchone()[0])
                    self.assertEqual(server.network_collection(db, region, dataset), source)
                    self.assertEqual(db.execute('SELECT count(*) FROM network_sites WHERE region_id=? AND dataset_path=?', (region, dataset)).fetchone()[0], count)
                    site_id, longitude, latitude, feature = db.execute('SELECT site_id, longitude, latitude, feature FROM network_sites WHERE region_id=? AND dataset_path=? ORDER BY ordinal LIMIT 1', (region, dataset)).fetchone()
                    self.assertEqual([longitude, latitude], json.loads(feature)['geometry']['coordinates'][:2])
                    self.assertEqual(site_id, source['features'][0]['properties'].get('site_id', source['features'][0]['properties'].get('id')))
                feature = json.loads(feature)
                feature['properties']['database_test'] = 'retained'
                feature['geometry']['coordinates'][0] += 0.001
                db.execute('UPDATE network_sites SET feature=? WHERE region_id=? AND dataset_path=? AND site_id=?',
                           (json.dumps(feature), region, dataset, site_id))
            server.initialize(path)
            with closing(sqlite3.connect(path)) as db, db:
                result = server.network_collection(db, region, dataset)
                self.assertEqual(result['features'][0], feature)
                self.assertEqual(db.execute('SELECT longitude FROM network_sites WHERE region_id=? AND dataset_path=? AND site_id=?', (region, dataset, site_id)).fetchone()[0], feature['geometry']['coordinates'][0])
                self.assertNotIn('database_test', json.loads(db.execute('SELECT content FROM region_assets WHERE region_id=? AND path=?', (region, dataset)).fetchone()[0])['features'][0]['properties'])
                self.assertIsNone(server.network_collection(db, 'toronto', 'verizon-poles.geojson'))

    def test_existing_database_migrates_stored_snapshot_and_membership(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'regions.sqlite3'
            server.initialize(path)
            with closing(sqlite3.connect(path)) as db, db:
                db.execute('DROP TABLE network_sites')
                db.execute('DROP TABLE network_datasets')
                region, dataset = 'toronto', 'bell-outdoor-sites.geojson'
                snapshot = json.loads(db.execute('SELECT content FROM region_assets WHERE region_id=? AND path=?', (region, dataset)).fetchone()[0])
                snapshot['features'][0]['properties']['migration_test'] = 'stored snapshot'
                db.execute('UPDATE region_assets SET content=? WHERE region_id=? AND path=?', (json.dumps(snapshot).encode(), region, dataset))
                db.execute('INSERT INTO project_sites VALUES (?, ?, ?)', (region, 'harbourfront', '["saved-id"]'))
            server.initialize(path)
            with closing(sqlite3.connect(path)) as db, db:
                self.assertEqual(server.network_collection(db, region, dataset), snapshot)
                self.assertEqual(db.execute('SELECT site_ids FROM project_sites').fetchone()[0], '["saved-id"]')

    def test_invalid_refresh_rolls_back_existing_data(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'regions.sqlite3'
            server.initialize(path)
            bad = Path(directory) / 'invalid.geojson'
            bad.write_text(json.dumps({'type': 'FeatureCollection', 'features': [
                {'type': 'Feature', 'properties': {'site_id': 'duplicate'}, 'geometry': {'type': 'Point', 'coordinates': [0, 0]}},
                {'type': 'Feature', 'properties': {'site_id': 'duplicate'}, 'geometry': {'type': 'Point', 'coordinates': [1, 1]}}]}))
            original_files = server.region_files
            def changed_files(region):
                for name, source in original_files(region):
                    yield name, bad if region['id'] == 'toronto' and name == 'bell-outdoor-sites.geojson' else source
            with closing(sqlite3.connect(path)) as db, db:
                old_fingerprint = db.execute('SELECT fingerprint FROM regions WHERE id=?', ('toronto',)).fetchone()[0]
                db.execute('INSERT INTO project_sites VALUES (?, ?, ?)', ('toronto', 'harbourfront', '["saved-id"]'))
            with patch.object(server, 'region_files', side_effect=changed_files):
                with self.assertRaisesRegex(ValueError, 'Invalid site'):
                    server.initialize(path)
            with closing(sqlite3.connect(path)) as db, db:
                self.assertEqual(db.execute('SELECT fingerprint FROM regions WHERE id=?', ('toronto',)).fetchone()[0], old_fingerprint)
                self.assertEqual(db.execute('SELECT count(*) FROM network_sites WHERE region_id=? AND dataset_path=?', ('toronto', 'bell-outdoor-sites.geojson')).fetchone()[0], 1481)
                self.assertEqual(db.execute('SELECT site_ids FROM project_sites').fetchone()[0], '["saved-id"]')
                refreshed = json.loads(db.execute('SELECT content FROM region_assets WHERE region_id=? AND path=?', ('toronto', 'bell-outdoor-sites.geojson')).fetchone()[0])
            refreshed['features'][0]['properties']['refresh_test'] = 'new source'
            bad.write_text(json.dumps(refreshed))
            with patch.object(server, 'region_files', side_effect=changed_files):
                server.initialize(path)
            with closing(sqlite3.connect(path)) as db:
                self.assertEqual(server.network_collection(db, 'toronto', 'bell-outdoor-sites.geojson'), refreshed)
                self.assertNotEqual(db.execute('SELECT fingerprint FROM regions WHERE id=?', ('toronto',)).fetchone()[0], old_fingerprint)
                self.assertEqual(db.execute('SELECT site_ids FROM project_sites').fetchone()[0], '["saved-id"]')

    def test_asset_endpoint_and_project_validation_use_site_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'regions.sqlite3'
            server.initialize(path)
            with closing(sqlite3.connect(path)) as db, db:
                site_id, feature = db.execute('SELECT site_id, feature FROM network_sites WHERE region_id=? AND dataset_path=? ORDER BY ordinal LIMIT 1', ('toronto', 'bell-outdoor-sites.geojson')).fetchone()
                feature = json.loads(feature)
                feature['properties']['endpoint_test'] = 'from row'
                db.execute('UPDATE network_sites SET feature=? WHERE region_id=? AND dataset_path=? AND site_id=?', (json.dumps(feature), 'toronto', 'bell-outdoor-sites.geojson', site_id))
            handler_type = server.handler_for(path)
            handler = handler_type.__new__(handler_type)
            handler.respond = Mock()
            handler.send_error = Mock()
            handler.path = '/api/regions/toronto/assets/bell-outdoor-sites.geojson'
            handler.do_GET()
            self.assertEqual(json.loads(handler.respond.call_args.args[0])['features'][0]['properties']['endpoint_test'], 'from row')
            handler.path = '/api/regions/toronto/projects/harbourfront/sites'
            payload = json.dumps([site_id]).encode()
            handler.headers = {'Content-Length': str(len(payload))}
            handler.rfile = io.BytesIO(payload)
            handler.do_PUT()
            handler.send_error.assert_not_called()
            with closing(sqlite3.connect(path)) as db:
                self.assertEqual(json.loads(db.execute('SELECT site_ids FROM project_sites WHERE region_id=? AND project_id=?', ('toronto', 'harbourfront')).fetchone()[0]), [site_id])
            payload = b'["unknown-site"]'
            handler.headers = {'Content-Length': str(len(payload))}
            handler.rfile = io.BytesIO(payload)
            handler.do_PUT()
            handler.send_error.assert_called_once_with(400, 'Unknown site ID')

    def test_project_tasks_are_validated_isolated_and_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'regions.sqlite3'
            server.initialize(path)
            handler_type = server.handler_for(path)
            handler = handler_type.__new__(handler_type)
            handler.respond, handler.send_error = Mock(), Mock()
            task = dict(id='DT-1', name='Morning test', driveSpeedKmh=30.5, routes=[dict(id='route-1', name='Main road', coordinates=[[-79.4, 43.7], [-79.41, 43.72]], waypoints=[[-79.4, 43.7], [-79.41, 43.72]], roadFit='fitted', fitMessage='Road fitted')])
            def put(tasks, project='northyork', region='toronto'):
                handler.path = f'/api/regions/{region}/projects/{project}/tasks'
                payload = json.dumps(tasks).encode()
                handler.headers = {'Content-Length': str(len(payload))}
                handler.rfile = io.BytesIO(payload)
                handler.send_error.reset_mock()
                handler.do_PUT()
            put([task])
            handler.send_error.assert_not_called()
            handler.do_GET()
            accepted = json.loads(handler.respond.call_args.args[0])
            self.assertEqual([{k:v for k,v in item.items() if k not in ('driveMetrics','speedCases')} for item in accepted], [task])
            self.assertGreater(accepted[0]['driveMetrics']['distanceKm'],0)
            for tasks in ([task, task], [{**task, 'id': '../bad'}], [{**task, 'routes': [dict(id='r', name='Bad', coordinates=[[True, 0], [1, 2]])]}], [{**task, 'routes': [dict(id='r', name='Bad', coordinates=[[1, 2], [1, 2]])]}]):
                put(tasks)
                self.assertEqual(handler.send_error.call_args.args[0], 400)
            for speed in (0, -1, 200.1, True, '30', float('inf')):
                put([{**task, 'driveSpeedKmh':speed}])
                self.assertEqual(handler.send_error.call_args.args[0], 400)
            put([task], 'unknown')
            handler.send_error.assert_called_with(404)
            handler.path = '/api/regions/toronto/projects/etobicoke/tasks'
            handler.do_GET()
            self.assertEqual(json.loads(handler.respond.call_args.args[0]), [])
            put([task], 'manhattan', 'new-york')
            handler.send_error.assert_not_called()
            server.initialize(path)
            with closing(sqlite3.connect(path)) as db:
                self.assertEqual([{k:v for k,v in item.items() if k not in ('driveMetrics','speedCases')} for item in server.read_tasks(db,'toronto','northyork')], [task])
                self.assertEqual(db.execute('SELECT count(*) FROM drive_tasks').fetchone()[0], 2)
            put([])
            handler.send_error.assert_not_called()
            handler.do_GET()
            self.assertEqual(json.loads(handler.respond.call_args.args[0]), [])

    def test_verizon_filter_preserves_reported_status(self):
        rows = [dict(id='1', franchisee='NY SMSA', longitude='-73.98', latitude='40.75', status='Proposed'),
                dict(id='2', franchisee='Crown Castle', longitude='-73.98', latitude='40.75'),
                dict(id='3', franchisee='NY SMSA', longitude='invalid', latitude='40.75')]
        features = extractor.convert(rows)['features']
        self.assertEqual(len(features), 1)
        self.assertEqual(features[0]['properties']['status'], 'Proposed')


if __name__ == '__main__':
    unittest.main()
