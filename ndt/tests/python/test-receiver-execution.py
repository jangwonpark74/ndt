"""Saved receiver contracts, queued immutability, A/B and before-publication preflight."""
from contextlib import closing
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('drive_contracts',Path(__file__).with_name('test-drive-integration.py'))
contracts=importlib.util.module_from_spec(spec);spec.loader.exec_module(contracts)
from backend.dm.polarization import RECEIVER_MODEL
from backend.dm.dm_model import connection
from backend.dm.integration import canonical

TEMPLATE=dict(rat='NR',frequencyMHz=3600,bandwidthMHz=100,powerDbm=30,gainDbi=0,lossDb=0,
              azimuthDeg=0,tiltDeg=0,pattern='isotropic',mode='LOS',
              carrier=dict(standard='3gpp-rel18-carrier-subset-v1',band='n78',channel=640000,scsKHz=30))
RECEIVER=dict(model=RECEIVER_MODEL,collection='dual-orthogonal',
              orientation=dict(azimuthDeg=0,tiltDeg=0,rollDeg=0,slantDeg=90))


class ReceiverExecution(unittest.TestCase):
    def setUp(self):
        self.f=contracts.DriveIntegration('test_directional_experiment_uses_frozen_template_powers_and_model_version')
        self.f.setUp();self.addCleanup(self.f.doCleanups)

    def save(self,revision=0,receiver=None):
        template=deepcopy(TEMPLATE)
        if receiver is not None:template['polarization']=dict(model='3gpp-38.901-model2',slantDeg=0,rollDeg=0)
        body=dict(id='study',name='Receiver reference',expectedRevision=revision,action='save',template=template,overrides={})
        if receiver is not None:body['receiver']=receiver
        with closing(contracts.connect(self.f.planning)) as db,db:
            result=contracts.save_scenario(db,'toronto','p',body)
        return result

    def action(self,action,revision):
        with closing(contracts.connect(self.f.planning)) as db,db:
            return contracts.save_scenario(db,'toronto','p',dict(id='study',action=action,expectedRevision=revision))

    def specification(self):
        return {**self.f.specification(),'scenario_id':'study','experiment_type':'scenario-ab'}

    def baseline(self):
        self.save();self.action('baseline',1)

    def test_saved_receiver_is_retained_and_frozen_ideal_dual_matches_baseline(self):
        self.baseline();saved=self.save(1,deepcopy(RECEIVER));self.action('apply',2)
        self.assertEqual(saved['versions'][-1]['receiver'],RECEIVER)
        self.assertEqual(saved['versions'][-1]['modelVersion'],'uma-los-receiver-v5')
        self.assertEqual(contracts.catalog(self.f.planning)['projects'][0]['scenarios'][0]['receiver'],RECEIVER)
        job=self.f.store.submit('receiver-dual',self.specification())
        self.assertEqual(job['snapshot']['predictionModel'],'uma-los-receiver-fixed-heights-v6')
        self.assertEqual(job['snapshot']['schema'],'ndt.execution.v6')
        self.assertTrue(any(c['parameter']=='receiver' and c['affectsPrediction'] for c in job['snapshot']['scenarioChanges']))
        # Later edits cannot change either queued member's receiver.
        self.save(2,{**deepcopy(RECEIVER),'collection':'single-linear'})
        self.f.store.run_one();result=self.f.store.get(job['id'])
        self.assertEqual(result['status'],'completed',result['error'])
        self.assertTrue(all(abs(pair['median_delta_db'])<1e-9 for pair in result['comparisons']))
        a,b=[contracts.get_test(self.f.tests,r['test_id']) for r in result['runs'][:2]]
        self.assertNotIn('receiver',a['context']['radioScenario']['payload'])
        self.assertEqual(b['context']['radioScenario']['payload']['receiver'],RECEIVER)

    def test_frozen_invalid_receiver_on_either_side_publishes_no_members(self):
        for side in ['radioScenario','radioBaseline']:
            with self.subTest(side=side):
                if side=='radioScenario':
                    self.baseline();self.save(1,deepcopy(RECEIVER));self.action('apply',2)
                else:
                    self.action('baseline',2)
                job=self.f.store.submit('invalid-'+side,self.specification())
                frozen=deepcopy(job['snapshot']);frozen[side]['payload']['receiver']['collection']='future-receiver'
                with connection(self.f.tests) as db:
                    db.execute('UPDATE execution_snapshots SET payload=? WHERE id=?',(canonical(frozen),job['snapshot']['id']))
                self.f.store.run_one();result=self.f.store.get(job['id'])
                self.assertEqual(result['status'],'failed');self.assertEqual(result['runs'],[])

    def test_grid_receiver_missing_frozen_assumptions_publishes_no_scalar_a_first(self):
        spec=importlib.util.spec_from_file_location('sampled_receiver_contracts',Path(__file__).with_name('test-sampled-execution.py'))
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        f=module.SampledExecution('test_full_source_grid_governs_prediction_gain_once_and_freezes_qualification')
        f.setUp();self.addCleanup(f.doCleanups)
        plain=deepcopy(f.port);plain.pop('sampled');plain.update(pattern='element',gainDbi=8)
        f.save(port=plain)
        with closing(contracts.connect(f.f.planning)) as db,db:
            contracts.save_scenario(db,'toronto','p',dict(id='grid-study',action='baseline',expectedRevision=1))
            db.commit()
            default=deepcopy(module.DEFAULT)|dict(mode='LOS',polarization=dict(model='3gpp-38.901-model2',slantDeg=0,rollDeg=0))
            port=deepcopy(f.port)|dict(mode='LOS',polarization=dict(model='3gpp-38.901-model2',slantDeg=0))
            contracts.save_scenario(db,'toronto','p',dict(id='grid-study',name='Grid receiver',action='save',expectedRevision=1,
                template=default,overrides={},assignmentMode='cells',cells=[dict(cellId='cell-1',ports=[port])],
                radioBudgets={'radio-1':35},receiver=deepcopy(RECEIVER)))
        f.apply(2)
        job=f.f.store.submit('missing-grid-receiver-assumptions',f.execution(experiment_type='scenario-ab'))
        snapshot=deepcopy(job['snapshot']);del snapshot['patternAssumptions']
        with connection(f.f.tests) as db:
            db.execute('UPDATE execution_snapshots SET payload=? WHERE id=?',(canonical(snapshot),job['snapshot']['id']))
        f.f.store.run_one();result=f.f.store.get(job['id'])
        self.assertEqual(result['status'],'failed');self.assertEqual(result['runs'],[])


if __name__=='__main__':unittest.main()
