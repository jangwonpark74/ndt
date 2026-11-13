"""Contracts written before the DM integration implementation."""
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.task_store import connect, initialize_tasks, write_tasks
from backend.dm.integration import catalog, freeze_context, match_route
from backend.dm.experiments import ExperimentStore, ExperimentWorker
from backend.dm.dm_model import Conflict, get_test, initialize, save_test
from backend.radio_scenarios import initialize_scenarios,save_scenario
from backend.equipment_inventory import initialize_inventory,import_inventory
from backend.dm.simulation import DIRECTIONAL_MODEL
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from backend.dm import integration
from backend import carrier_plan


SCOPE = dict(region_id='toronto', project_id='p', task_id='T')
TASK = dict(id='T', name='Test route', routes=[dict(id='r', name='Main road',
    coordinates=[[-79.4, 43.7], [-79.399, 43.7], [-79.398, 43.7]])],
    speedCases=[dict(id='c20', name='20 km/h', speedKmh=20), dict(id='c40', name='40 km/h', speedKmh=40)])


class DriveIntegration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.planning = Path(self.temp.name) / 'planning.sqlite3'
        self.tests = Path(self.temp.name) / 'tests.sqlite3'
        with closing(connect(self.planning)) as db, db:
            db.executescript('''CREATE TABLE regions(id TEXT PRIMARY KEY,metadata TEXT,fingerprint TEXT);
                CREATE TABLE project_sites(region_id TEXT,project_id TEXT,site_ids TEXT);
                CREATE TABLE network_sites(region_id TEXT,dataset_path TEXT,site_id TEXT,ordinal INTEGER,feature TEXT);''')
            db.execute('INSERT INTO regions VALUES (?,?,?)', ('toronto', json.dumps(dict(id='toronto', name='Toronto',
                network='ised', projects=[dict(id='p', name='Project', center=[-79.4, 43.7])])), 'source-v1'))
            site = dict(type='Feature', geometry=dict(type='Point', coordinates=[-79.4, 43.701]),
                properties=dict(site_id='s', provider='Bell', records=[dict(tx_ant_omni_indicator='D',
                    tx_ant_azimuth=str(a), beamwidths=['65'], frequencies=['3500']) for a in (0, 120, 240)]))
            db.execute('INSERT INTO network_sites VALUES (?,?,?,?,?)', ('toronto', 'bell-outdoor-sites.geojson', 's', 0, json.dumps(site)))
            db.execute('INSERT INTO project_sites VALUES (?,?,?)', ('toronto', 'p', '["s"]'))
            initialize_tasks(db)
            initialize_scenarios(db)
            initialize_inventory(db)
            write_tasks(db, 'toronto', 'p', [TASK])
        initialize(self.tests)
        self.store = ExperimentStore(self.tests, self.planning)

    def context(self):
        return catalog(self.planning)['tasks'][0]

    def selection(self):
        return dict(**SCOPE, route_id='r', context_hash=self.context()['context_hash'])

    def specification(self):
        return dict(**self.selection(), case_ids=['c20', 'c40'], interval_s=1, rat='NR', mode='NLOS',
                    power_a_dbm=46, power_b_dbm=49, transmitter_id='s:3500', experiment_type='parameter-ab')

    def install_scenario(self,qualified=True,revision=0,tilt=6,overrides=None):
        template=dict(rat='NR',frequencyMHz=3600,bandwidthMHz=100,powerDbm=40,gainDbi=8,lossDb=2,
                      azimuthDeg=180,tiltDeg=tilt,pattern='element',mode='NLOS')
        if qualified:template['carrier']=dict(standard='3gpp-rel18-carrier-subset-v1',band='n78',channel=640000,scsKHz=30)
        for action,expected in [('save',revision),('apply',revision+1)]:
            with closing(connect(self.planning)) as db,db:
                save_scenario(db,'toronto','p',dict(id='study',name='Directional study',expectedRevision=expected,action=action,template=template,overrides=overrides or {}))

    def install_equipment(self,revision=0):
        data=json.loads((Path(__file__).parents[1]/'fixtures/equipment-example.json').read_text())
        data['sites'][0]['inventorySiteId']='s';data['radios'][0]['powerDbm']=40+revision
        raw=b'\xef\xbb\xbf'+json.dumps(data).encode()
        with closing(connect(self.planning)) as db,db:import_inventory(db,'toronto','p',raw,revision)
        return raw

    def test_selected_scenario_and_complete_source_inputs_are_frozen(self):
        self.install_scenario();raw=self.install_equipment()
        selection={**self.selection(),'scenario_id':'study'}
        project=catalog(self.planning)['projects'][0]
        self.assertEqual(project['scenarios'][0]['revision'],1)
        self.assertTrue(project['scenarios'][0]['qualified'])
        frozen=freeze_context(self.planning,selection)
        self.assertEqual(frozen['radioScenario']['payload']['template']['carrier']['band'],'n78')
        self.assertEqual(frozen['predictionModel'],DIRECTIONAL_MODEL)
        self.assertTrue(any('ts_138104v180500p.pdf' in reference['url'] for reference in frozen['modelReferences']))
        self.assertEqual(frozen['transmitters'][0]['frequency_mhz'],3600)
        self.assertEqual(frozen['transmitters'][0]['template']['azimuthDeg'],180)
        inventory=frozen['inventorySnapshot']
        self.assertEqual(inventory['regionalFingerprint'],'source-v1')
        self.assertEqual(inventory['operatorEquipment']['raw'],raw.decode())
        self.assertEqual(len(inventory['licensedSites'][0]['properties']['records']),3)
        self.install_scenario(revision=1,tilt=18);self.install_equipment(revision=1)
        with self.assertRaises(Conflict):freeze_context(self.planning,selection)
        self.assertEqual(frozen['radioScenario']['payload']['template']['tiltDeg'],6)
        self.assertEqual(frozen['inventorySnapshot']['operatorEquipment']['raw'],raw.decode())

    def test_changed_source_and_unqualified_scenario_cannot_launch_a_qualified_run(self):
        self.install_scenario();selection={**self.selection(),'scenario_id':'study'}
        self.install_equipment()
        with self.assertRaises(Conflict):freeze_context(self.planning,selection)
        selection={**self.selection(),'scenario_id':'study'}
        with closing(connect(self.planning)) as db,db:db.execute("UPDATE regions SET fingerprint='source-v2'")
        with self.assertRaises(Conflict):freeze_context(self.planning,selection)
        with self.assertRaisesRegex(ValueError,'Source inventory changed'):
            freeze_context(self.planning,{**self.selection(),'scenario_id':'study'})
        self.install_scenario(qualified=False,revision=1)
        with self.assertRaisesRegex(ValueError,'Choose a supported band'):
            freeze_context(self.planning,{**self.selection(),'scenario_id':'study'})

    def test_directional_experiment_uses_frozen_template_powers_and_model_version(self):
        self.install_scenario();raw=self.install_equipment()
        spec={**self.specification(),'scenario_id':'study','power_a_dbm':90}
        experiment=self.store.submit('directional',spec)
        self.install_scenario(revision=1,tilt=18);self.install_equipment(revision=1)
        self.assertEqual(self.store.submit('directional',spec)['id'],experiment['id'])
        self.assertTrue(self.store.run_one());result=self.store.get(experiment['id'])
        self.assertEqual(result['status'],'completed',result['error'])
        a,b=[get_test(self.tests,r['test_id']) for r in result['runs'][:2]]
        self.assertEqual(a['context']['model'],DIRECTIONAL_MODEL)
        self.assertEqual(a['context']['powers']['s:3500'],46)
        self.assertEqual(a['context']['inventorySnapshot']['operatorEquipment']['raw'],raw.decode())
        self.assertEqual(a['context']['radioScenario']['revision'],1)
        self.assertEqual(a['context']['transmitters'][0]['template']['tiltDeg'],6)
        for left,right in zip(a['rows'],b['rows']):self.assertAlmostEqual(right['predicted_rx_dbm']-left['predicted_rx_dbm'],3)
        self.assertAlmostEqual(result['comparisons'][0]['median_delta_db'],3)

    def test_site_override_carrier_controls_rat_and_zero_change_pair(self):
        override=dict(rat='LTE',frequencyMHz=2140,bandwidthMHz=20,powerDbm=40,gainDbi=0,lossDb=2,
                      azimuthDeg=0,tiltDeg=6,pattern='isotropic',mode='LOS',
                      carrier=dict(standard='3gpp-rel18-carrier-subset-v1',band='B4',channel=2250,scsKHz=15))
        self.install_scenario(overrides={'s':override})
        context=catalog(self.planning)['projects'][0]['scenarios'][0]
        self.assertEqual(context['transmitters'][0]['rat'],'LTE')
        self.assertEqual(context['transmitters'][0]['frequency_mhz'],2140)
        spec={**self.specification(),'scenario_id':'study'}
        with self.assertRaisesRegex(ValueError,'NR'):self.store.submit('wrong-rat',spec)
        saved=self.store.submit('lte',{**spec,'rat':'LTE','power_b_dbm':38})
        self.assertTrue(self.store.run_one());result=self.store.get(saved['id'])
        self.assertEqual(result['status'],'completed',result['error'])
        a,b=[get_test(self.tests,r['test_id']) for r in result['runs'][:2]]
        self.assertEqual(a['rows'],b['rows']);self.assertEqual(a['rows'][0]['rat'],'LTE')
        self.assertEqual(a['context']['powers']['s:3500'],38)

    def test_freeze_reads_one_database_snapshot_during_a_concurrent_update(self):
        self.install_scenario();raw=self.install_equipment()
        with closing(connect(self.planning)) as db:db.execute('PRAGMA journal_mode=WAL')
        selection={**self.selection(),'scenario_id':'study'};original=integration._catalog
        def update_after_catalog(db):
            result=original(db)
            self.install_equipment(revision=1)
            with closing(connect(self.planning)) as writer,writer:
                feature=json.loads(writer.execute('SELECT feature FROM network_sites').fetchone()[0])
                feature['geometry']['coordinates'][0]-=.01
                writer.execute('UPDATE network_sites SET feature=?',(json.dumps(feature),))
                writer.execute("UPDATE regions SET fingerprint='source-v2'")
            return result
        with patch.object(integration,'_catalog',side_effect=update_after_catalog):
            frozen=freeze_context(self.planning,selection)
        self.assertEqual(frozen['inventorySnapshot']['operatorEquipment']['revision'],1)
        self.assertEqual(frozen['inventorySnapshot']['operatorEquipment']['raw'],raw.decode())
        self.assertEqual(frozen['inventorySnapshot']['licensedSites'][0]['geometry']['coordinates'],[-79.4,43.701])
        self.assertEqual(catalog(self.planning)['projects'][0]['equipment']['revision'],2)

    def test_newer_saved_revision_is_not_silently_applied_to_a_run(self):
        self.install_scenario()
        with closing(connect(self.planning)) as db,db:
            payload=json.loads(db.execute('SELECT payload FROM radio_scenario_versions').fetchone()[0])
            save_scenario(db,'toronto','p',dict(id='study',name='Unapplied new name',action='save',expectedRevision=1,
                                              template={**payload['template'],'tiltDeg':30},overrides={}))
        metadata=catalog(self.planning)['projects'][0]['scenarios'][0]
        self.assertEqual(metadata['revision'],1);self.assertEqual(metadata['draftRevision'],2)
        self.assertEqual(metadata['name'],'Directional study')
        frozen=freeze_context(self.planning,{**self.selection(),'scenario_id':'study'})
        self.assertEqual(frozen['radioScenario']['payload']['template']['tiltDeg'],6)

    def test_a_queued_run_keeps_its_carrier_qualification_when_the_live_plan_changes(self):
        self.install_scenario();job=self.store.submit('pinned-plan',{**self.specification(),'scenario_id':'study'})
        with patch.dict(carrier_plan.PLAN,version='future-plan-version'):
            self.assertTrue(self.store.run_one())
        result=self.store.get(job['id'])
        self.assertEqual(result['status'],'completed',result['error'])
        self.assertEqual(result['snapshot']['radioScenario']['payload']['template']['carrier']['standard'],'3gpp-rel18-carrier-subset-v1')

    def test_route_context_is_complete_and_stale_selection_cannot_launch(self):
        context = self.context()
        self.assertEqual(context['routes'][0]['coordinates'], TASK['routes'][0]['coordinates'])
        self.assertEqual(len(context['speedCases']), 2)
        self.assertEqual(context['transmitters'][0]['id'], 's:3500')
        selection = self.selection()
        snapshot = freeze_context(self.planning, selection)
        with closing(connect(self.planning)) as db, db:
            write_tasks(db, 'toronto', 'p', [{**TASK, 'name': 'Changed'}])
        with self.assertRaises(Conflict):
            freeze_context(self.planning, selection)
        self.assertEqual(snapshot['route']['coordinates'], TASK['routes'][0]['coordinates'])

    def test_paired_power_runs_are_deterministic_and_survive_task_deletion(self):
        spec = self.specification()
        experiment = self.store.submit('request-1', spec)
        self.assertEqual(self.store.submit('request-1', spec)['id'], experiment['id'])
        self.assertTrue(self.store.run_one())
        result = self.store.get(experiment['id'])
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(len(result['runs']), 4)
        self.assertEqual(len(result['comparisons']), 2)
        a, b = [get_test(self.tests, r['test_id']) for r in result['runs'][:2]]
        self.assertEqual(a['kind'], 'simulated')
        self.assertEqual([(r['t'], r['longitude'], r['latitude']) for r in a['rows']],
                         [(r['t'], r['longitude'], r['latitude']) for r in b['rows']])
        for left, right in zip(a['rows'], b['rows']):
            self.assertAlmostEqual(right['predicted_rx_dbm'] - left['predicted_rx_dbm'], 3)
            self.assertNotIn('rsrp_dbm', left)
        self.assertAlmostEqual(result['comparisons'][0]['median_delta_db'], 3)
        self.assertEqual(a['rows'][0]['longitude'], -79.4)
        self.assertEqual(a['rows'][-1]['longitude'], -79.398)
        with closing(connect(self.planning)) as db, db:
            write_tasks(db, 'toronto', 'p', [])
        self.assertEqual(get_test(self.tests, a['id'])['context']['route']['coordinates'], TASK['routes'][0]['coordinates'])
        self.assertEqual(self.store.get(result['id'])['comparisons'], result['comparisons'])

    def test_execution_uses_frozen_fitted_geometry_even_if_saved_route_changes(self):
        fitted = {**TASK['routes'][0], 'roadFit': 'fitted',
                  'coordinates': [[-79.4, 43.7], [-79.399, 43.701], [-79.398, 43.7]]}
        with closing(connect(self.planning)) as db, db:
            write_tasks(db, 'toronto', 'p', [{**TASK, 'routes': [fitted]}])
        job = self.store.submit('fitted-route', self.specification())
        with closing(connect(self.planning)) as db, db:
            write_tasks(db, 'toronto', 'p', [TASK])
        self.assertTrue(self.store.run_one())
        result = self.store.get(job['id'])
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['snapshot']['route']['coordinates'], fitted['coordinates'])
        for run in result['runs']:
            saved = get_test(self.tests, run['test_id'])
            self.assertEqual(saved['context']['route']['coordinates'], fitted['coordinates'])
            self.assertEqual(saved['context']['route']['roadFit'], 'fitted')

    def test_conflicting_retry_invalid_inputs_and_cancellation_are_safe(self):
        spec = self.specification()
        experiment = self.store.submit('same', spec)
        with self.assertRaises(Conflict):
            self.store.submit('same', {**spec, 'power_b_dbm': 50})
        for values in ({'power_b_dbm': float('nan')}, {'interval_s': 0}, {'case_ids': ['missing']},
                       {'transmitter_id': 'missing'}, {'tilt': 3}, {'power_a_dbm': True}, {'power_a_dbm':10**400},
                       {'scenario_id':True},{'scenario_id':[]},{'scenario_id':'bad/name'}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.store.submit('bad', {**spec, **values})
        self.store.cancel(experiment['id'])
        self.assertFalse(self.store.run_one())
        self.assertEqual(self.store.get(experiment['id'])['status'], 'cancelled')

    def test_trace_association_retains_gaps_and_rejects_wrong_route_or_direction(self):
        route = TASK['routes'][0]
        rows = [dict(t=0, rat='NR', longitude=-79.4, latitude=43.7),
                dict(t=1000, rat='NR'),
                dict(t=2000, rat='NR', longitude=-79.398, latitude=43.7),
                dict(t=3000, rat='NR', longitude=-80, latitude=44)]
        matched = match_route(rows, route)
        self.assertEqual([m['status'] for m in matched['samples']], ['matched', 'missing-gps', 'matched', 'off-route'])
        self.assertEqual(matched['route_coverage_pct'], 0)
        reverse = match_route([rows[2], {**rows[0], 't': 3000}], route)
        self.assertEqual(reverse['samples'][-1]['status'], 'wrong-direction')
        self.assertEqual(match_route([rows[2], {**rows[0], 't': 3000}], route, direction='reverse')['samples'][-1]['status'], 'matched')

    def test_generated_runs_are_distinct_from_old_demo_and_capture_payloads(self):
        raw = b'timestamp,latitude,longitude,rat,rsrp_dbm\n2026-11-12T00:00:00Z,43.7,-79.4,NR,-95\n'
        saved = save_test(self.tests, 'import', SCOPE, 'Measured', '', 'capture.csv', raw)
        before = get_test(self.tests, saved['id'])
        self.store.associate(saved['id'], self.selection())
        after = get_test(self.tests, saved['id'])
        self.assertEqual(before['rows'], after['rows'])
        self.assertEqual(before['sha256'], after['sha256'])
        self.assertEqual(after['context']['route']['id'], 'r')
        initialize(self.tests)
        self.assertEqual(get_test(self.tests, saved['id'])['kind'], 'imported')
        with closing(sqlite3.connect(self.tests)) as db:
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_association_versions_and_comparisons_keep_their_original_matching_basis(self):
        ids = []
        for power in (-100, -97):
            raw = ('timestamp,latitude,longitude,rat,rsrp_dbm,dl_mbps\n'+''.join(
                f'2026-11-12T00:00:{i:02d}Z,43.7,{-79.4+i*.002/40},NR,{power},{power+120}\n' for i in range(41))).encode()
            saved = save_test(self.tests, str(power), SCOPE, 'Capture', '', 'capture.csv', raw)
            self.store.associate(saved['id'], self.selection())
            ids.append(saved['id'])
        from backend.dm.dm_model import DEFAULT_PROFILE
        comparison = self.store.compare(*ids, 'rsrp_dbm', DEFAULT_PROFILE)
        self.assertAlmostEqual(comparison['median_delta_db'], 3)
        self.assertEqual(comparison['a_association']['direction'], 'forward')
        throughput=self.store.compare(*ids,'dl_mbps',DEFAULT_PROFILE)
        self.assertEqual(throughput['delta_unit'],'Mbps')
        self.assertAlmostEqual(throughput['median_delta'],3)
        self.assertNotIn('median_delta_db',throughput)
        self.store.associate(ids[0], {**self.selection(), 'direction': 'reverse'})
        with closing(sqlite3.connect(self.tests)) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM route_associations WHERE test_id=?', (ids[0],)).fetchone()[0], 2)
            original = json.loads(db.execute('SELECT payload FROM comparisons WHERE id=?', (comparison['id'],)).fetchone()[0])
        self.assertEqual(original['a_association']['direction'], 'forward')

    def test_concurrent_retry_creates_one_job_and_identical_variants_compare_to_zero(self):
        spec = {**self.specification(), 'power_b_dbm': 46}
        with ThreadPoolExecutor(max_workers=3) as pool:
            jobs = list(pool.map(lambda _: self.store.submit('concurrent', spec), range(3)))
        self.assertEqual(len({job['id'] for job in jobs}), 1)
        self.store.run_one()
        self.assertEqual(self.store.get(jobs[0]['id'])['comparisons'][0]['median_delta_db'], 0)

    def test_missing_gps_on_one_rat_does_not_break_a_shared_timestamp_fix(self):
        rows = [dict(t=0,rat='LTE'),dict(t=0,rat='NR',longitude=-79.4,latitude=43.7),
                dict(t=1000,rat='LTE'),dict(t=1000,rat='NR',longitude=-79.398,latitude=43.7)]
        result = match_route(rows, TASK['routes'][0])
        self.assertAlmostEqual(result['route_coverage_pct'], 100)
        self.assertEqual(result['samples'][2]['status'], 'missing-gps')

    def test_only_the_worker_owner_recovers_interrupted_jobs(self):
        job=self.store.submit('owner',self.specification())
        with closing(sqlite3.connect(self.tests)) as db,db:
            db.execute("UPDATE experiments SET status='running' WHERE id=?",(job['id'],))
        first=ExperimentWorker(self.store)
        self.addCleanup(first.close)
        self.assertEqual(self.store.get(job['id'])['status'],'interrupted')
        with closing(sqlite3.connect(self.tests)) as db,db:
            db.execute("UPDATE experiments SET status='running' WHERE id=?",(job['id'],))
        second=ExperimentWorker(ExperimentStore(self.tests,self.planning))
        self.addCleanup(second.close)
        self.assertIsNone(second.thread)
        self.assertEqual(self.store.get(job['id'])['status'],'running')
        first.close()
        third=ExperimentWorker(ExperimentStore(self.tests,self.planning))
        self.addCleanup(third.close)
        self.assertIsNotNone(third.thread)
        self.assertEqual(self.store.get(job['id'])['status'],'interrupted')


if __name__ == '__main__':
    unittest.main()
