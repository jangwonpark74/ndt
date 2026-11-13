"""A saved baseline/applied comparison freezes both template revisions."""
from contextlib import closing
import importlib.util
import json
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('drive_contracts',Path(__file__).with_name('test-drive-integration.py'))
contracts=importlib.util.module_from_spec(spec);spec.loader.exec_module(contracts)
from backend.dm.dm_model import connection
from backend.dm.integration import canonical

class ScenarioComparison(unittest.TestCase):
    def setUp(self):
        self.fixture=contracts.DriveIntegration('test_directional_experiment_uses_frozen_template_powers_and_model_version')
        self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)

    def baseline(self):
        f=self.fixture;f.install_scenario()
        with closing(contracts.connect(f.planning)) as db,db:
            contracts.save_scenario(db,'toronto','p',dict(id='study',action='baseline',expectedRevision=1))

    def specification(self):
        return {**self.fixture.specification(),'scenario_id':'study','experiment_type':'scenario-ab'}

    def test_baseline_and_applied_patterns_are_frozen_and_used_for_both_speed_pairs(self):
        f=self.fixture;self.baseline();f.install_scenario(revision=1,tilt=24)
        submitted=f.store.submit('scenario-pair',self.specification())
        self.assertEqual(submitted['snapshot']['radioBaseline']['revision'],1)
        self.assertEqual(submitted['snapshot']['radioScenario']['revision'],2)
        self.assertEqual(submitted['snapshot']['scenarioChanges'][0]['parameter'],'tiltDeg')
        f.install_scenario(revision=2,tilt=40)
        self.assertTrue(f.store.run_one());result=f.store.get(submitted['id'])
        self.assertEqual(result['status'],'completed',result['error']);self.assertEqual(len(result['comparisons']),2)
        a,b=[contracts.get_test(f.tests,r['test_id']) for r in result['runs'][:2]]
        self.assertEqual(a['context']['radioScenario']['revision'],1);self.assertEqual(b['context']['radioScenario']['revision'],2)
        self.assertEqual(a['context']['radioScenario']['baselineRevision'],1)
        self.assertEqual(a['context']['scenarioComparison']['appliedRevision'],2)
        self.assertEqual(a['context']['transmitters'][0]['template']['tiltDeg'],6)
        self.assertEqual(b['context']['transmitters'][0]['template']['tiltDeg'],24)
        self.assertNotEqual(a['rows'][0]['predicted_rx_dbm'],b['rows'][0]['predicted_rx_dbm'])
        self.assertEqual(a['rows'][0]['t'],b['rows'][0]['t'])

    def test_identical_revisions_compare_to_zero_and_missing_baseline_is_actionable(self):
        f=self.fixture;f.install_scenario()
        with self.assertRaisesRegex(ValueError,'[Bb]aseline'):
            f.store.submit('missing-baseline',self.specification())
        with closing(contracts.connect(f.planning)) as db,db:
            contracts.save_scenario(db,'toronto','p',dict(id='study',action='baseline',expectedRevision=1))
        job=f.store.submit('identical',self.specification());f.store.run_one();result=f.store.get(job['id'])
        self.assertEqual(result['status'],'completed',result['error'])
        self.assertTrue(all(abs(pair['median_delta_db'])<1e-9 for pair in result['comparisons']))
        self.assertEqual(result['snapshot']['scenarioChanges'],[])

    def test_unknown_frozen_experiment_type_fails_without_publishing_members(self):
        f=self.fixture;self.baseline();job=f.store.submit('future-type',self.specification())
        with connection(f.tests) as db:
            changed={**job['spec'],'experiment_type':'future-model-study'}
            db.execute('UPDATE experiments SET spec=? WHERE id=?',(canonical(changed),job['id']))
        f.store.run_one();result=f.store.get(job['id'])
        self.assertEqual(result['status'],'failed');self.assertIn('experiment type',result['error']);self.assertEqual(result['runs'],[])

    def test_unqualified_or_outdated_baseline_cannot_be_used_with_a_qualified_applied_revision(self):
        f=self.fixture;f.install_scenario(qualified=False)
        with closing(contracts.connect(f.planning)) as db,db:
            contracts.save_scenario(db,'toronto','p',dict(id='study',action='baseline',expectedRevision=1))
        f.install_scenario(revision=1)
        with self.assertRaisesRegex(ValueError,'Baseline'):
            f.store.submit('unqualified-baseline',self.specification())
        with closing(contracts.connect(f.planning)) as db,db:
            contracts.save_scenario(db,'toronto','p',dict(id='study',action='baseline',expectedRevision=2))
            db.execute("UPDATE regions SET fingerprint='source-v2'")
        f.install_scenario(revision=2)
        with self.assertRaisesRegex(ValueError,'Baseline source'):
            f.store.submit('old-source-baseline',self.specification())

    def test_carrier_band_and_bandwidth_metadata_changes_do_not_create_a_power_effect(self):
        f=self.fixture;self.baseline()
        with closing(contracts.connect(f.planning)) as db:
            template=json.loads(db.execute('SELECT payload FROM radio_scenario_versions WHERE revision=1').fetchone()[0])['template']
        template={**template,'bandwidthMHz':80,'carrier':{**template['carrier'],'band':'n77'}}
        f.install_scenario(revision=1,overrides={'s':template})
        job=f.store.submit('metadata-only',self.specification());f.store.run_one();result=f.store.get(job['id'])
        self.assertEqual(result['status'],'completed',result['error'])
        self.assertTrue(all(not change['affectsPrediction'] for change in result['snapshot']['scenarioChanges']))
        self.assertEqual(len(result['snapshot']['scenarioChanges']),2)
        self.assertTrue(all(abs(pair['median_delta_db'])<1e-9 for pair in result['comparisons']))

if __name__=='__main__':unittest.main()
