"""Frozen source-grid execution and physical reference-plane contracts."""
from contextlib import closing
from copy import deepcopy
import hashlib,importlib.util,json,math,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('pattern_contracts',Path(__file__).with_name('test-drive-integration.py'));contracts=importlib.util.module_from_spec(spec);spec.loader.exec_module(contracts)
from backend.dm.simulation import path_loss,model_for
from backend.dm.integration import distance,qualified_scenario
from backend.dm.dm_model import connection
ROOT=Path(__file__).parents[1]/'fixtures'
NR=dict(rat='NR',frequencyMHz=3600,bandwidthMHz=100,powerDbm=30,gainDbi=10*math.log10(1.5),lossDb=2,azimuthDeg=180,tiltDeg=0,pattern='sampled',mode='NLOS',carrier=dict(standard='3gpp-rel18-carrier-subset-v1',band='n78',channel=640000,scsKHz=30),sampled=dict(format='ndt.scalar-gain-grid.v1',patternId='pattern-1',rollDeg=0))
DEFAULT={k:v for k,v in NR.items() if k not in ('sampled','equipmentSource')};DEFAULT.update(pattern='element',gainDbi=8)

class SampledExecution(unittest.TestCase):
    def setUp(self):
        self.f=contracts.DriveIntegration('test_selected_scenario_and_complete_source_inputs_are_frozen');self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.data=json.loads((ROOT/'equipment-example.json').read_text(encoding='utf8'));self.data['schemaVersion']=2;self.data['sites'][0]['inventorySiteId']='s';self.data['cells'][0]['frequencyMHz']=3600;self.data['patterns'][0]['radiation']=json.loads((ROOT/'scalar-pattern-grid.json').read_text(encoding='utf8'))
        self.raw=b'\xef\xbb\xbf'+json.dumps(self.data).encode();self.sha=hashlib.sha256(self.raw).hexdigest()
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.import_inventory(db,'toronto','p',self.raw,0)
        self.port={**deepcopy(NR),'equipmentSource':dict(revision=1,sha256=self.sha,cellId='cell-1',linkId='link-1')}
    def save(self,revision=0,port=None):
        body=dict(id='grid-study',name='Qualified source grid',action='save',expectedRevision=revision,template=DEFAULT,overrides={},assignmentMode='cells',cells=[dict(cellId='cell-1',ports=[self.port if port is None else port])],radioBudgets={'radio-1':35})
        with closing(contracts.connect(self.f.planning)) as db,db:return contracts.save_scenario(db,'toronto','p',body)
    def apply(self,revision=1):
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.save_scenario(db,'toronto','p',dict(id='grid-study',action='apply',expectedRevision=revision))
    def execution(self,**fields):return {**self.f.specification(),'scenario_id':'grid-study','transmitter_id':'CELL:cell-1','experiment_type':'virtual-drive',**fields}
    def execute(self,request,**fields):
        job=self.f.store.submit(request,self.execution(**fields));self.f.store.run_one();result=self.f.store.get(job['id']);self.assertEqual(result['status'],'completed',result['error']);return result

    def test_full_source_grid_governs_prediction_gain_once_and_freezes_qualification(self):
        saved=self.save();self.assertEqual(saved['versions'][0]['modelVersion'],'uma-source-patterns-v4');self.apply();result=self.execute('grid-once')
        snapshot=result['snapshot'];self.assertEqual(snapshot['schema'],'ndt.execution.v5');self.assertEqual(snapshot['predictionModel'],'uma-source-patterns-fixed-heights-v5');self.assertEqual(snapshot['inventorySnapshot']['operatorEquipment']['raw'],self.raw.decode('utf8'))
        self.assertEqual(len(snapshot['patternModels']),1);self.assertFalse(snapshot['patternModels'][0]['independentlyVerified']);self.assertEqual(snapshot['patternModels'][0]['evidence'],'analytical-test')
        row=contracts.get_test(self.f.tests,result['runs'][0]['test_id'])['rows'][0];d=distance([-79.4,43.7],[-79.4,43.701]);down=math.degrees(math.atan2(23.5,d));gain=1.5*(1-down/90)+.15*(down/90)
        expected=30-2+10*math.log10(gain)-path_loss(d,3600,'NLOS');self.assertAlmostEqual(row['predicted_rx_dbm'],expected,places=9)
        self.assertIn('realized',snapshot['patternAssumptions']['gain'])

    def test_invalid_gain_coverage_and_unlinked_or_legacy_patterns_cannot_save(self):
        for field,value in [('gainDbi',20),('frequencyMHz',3500)]:
            port=deepcopy(self.port);port[field]=value
            if field=='frequencyMHz':port.pop('carrier')
            with self.subTest(field=field),self.assertRaises(ValueError):self.save(port=port)
        with closing(contracts.connect(self.f.planning)) as db,db:
            with self.assertRaisesRegex(ValueError,'cell'):contracts.save_scenario(db,'toronto','p',dict(id='legacy-grid',name='Invalid fallback',action='save',expectedRevision=0,template=DEFAULT,overrides={'s':self.port}))

    def test_old_library_identity_cannot_promote_a_grid_into_execution(self):
        saved=self.save();payload=deepcopy(saved['versions'][0]);payload['modelVersion']='uma-source-cells-v3'
        with closing(contracts.connect(self.f.planning)) as db:
            with self.assertRaisesRegex(ValueError,'pattern.*version|version.*pattern'):qualified_scenario(db,'toronto','p',payload,[])

    def test_queued_grid_and_existing_models_are_not_reinterpreted(self):
        self.save();self.apply();job=self.f.store.submit('frozen-before-import',self.execution())
        altered=deepcopy(self.data);altered['patterns'][0]['radiation']['gainDbi']=[[[v-3 for v in row] for row in frame] for frame in altered['patterns'][0]['radiation']['gainDbi']]
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.import_inventory(db,'toronto','p',json.dumps(altered).encode(),1)
        self.f.store.run_one();result=self.f.store.get(job['id']);self.assertEqual(result['status'],'completed',result['error']);self.assertEqual(result['snapshot']['inventorySnapshot']['operatorEquipment']['raw'],self.raw.decode('utf8'))
        for model in ['uma-element-fixed-heights-v2','uma-uniform-panel-fixed-heights-v3','uma-source-cells-fixed-heights-v4']:
            with self.subTest(model=model),self.assertRaisesRegex(ValueError,'grid|sampled'):model_for({**job['snapshot'],'predictionModel':model})

    def test_tampered_source_model_is_rejected_before_any_member_is_published(self):
        self.save();self.apply();job=self.f.store.submit('tampered-source-model',self.execution(experiment_type='parameter-ab',power_b_dbm=32))
        snapshot=deepcopy(job['snapshot']);snapshot['patternModels'][0]['antennaModel']='Wrong hardware'
        with connection(self.f.tests) as db:db.execute('UPDATE execution_snapshots SET payload=? WHERE id=?',(json.dumps(snapshot),job['snapshot']['id']))
        self.f.store.run_one();result=self.f.store.get(job['id']);self.assertEqual(result['status'],'failed');self.assertIn('pattern',result['error'].lower());self.assertEqual(result['runs'],[])

    def test_both_revision_budgets_are_checked_before_publishing_a_member(self):
        self.save();self.apply()
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.save_scenario(db,'toronto','p',dict(id='grid-study',action='baseline',expectedRevision=1))
        plain=deepcopy(self.port);plain.pop('sampled');plain.update(pattern='element',gainDbi=8);self.save(revision=1,port=plain);self.apply(2)
        job=self.f.store.submit('bad-frozen-b-budget',self.execution(experiment_type='scenario-ab'));snapshot=deepcopy(job['snapshot']);snapshot['radioScenario']['payload']['radioBudgets']['radio-1']=20
        with connection(self.f.tests) as db:db.execute('UPDATE execution_snapshots SET payload=? WHERE id=?',(json.dumps(snapshot),job['snapshot']['id']))
        self.f.store.run_one();result=self.f.store.get(job['id']);self.assertEqual(result['status'],'failed');self.assertIn('budget',result['error']);self.assertEqual(result['runs'],[])

    def test_grid_far_field_is_enforced_for_the_complete_cell(self):
        changed=deepcopy(self.data);changed['patterns'][0]['radiation']['maxDimensionM']=4;raw=json.dumps(changed).encode();sha=hashlib.sha256(raw).hexdigest()
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.import_inventory(db,'toronto','p',raw,1)
        self.port['equipmentSource'].update(revision=2,sha256=sha);self.save();self.apply();result=self.execute('near-grid')
        rows=contracts.get_test(self.f.tests,result['runs'][0]['test_id'])['rows'];self.assertTrue(all('predicted_rx_dbm' not in row for row in rows));self.assertTrue(any('far-field' in row.get('event','') for row in rows))

    def test_roll_orientation_and_grid_changes_are_comparable_with_existing_cell_models(self):
        self.save();self.apply()
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.save_scenario(db,'toronto','p',dict(id='grid-study',action='baseline',expectedRevision=1))
        changed=deepcopy(self.port);changed['sampled']['rollDeg']=90;self.save(revision=1,port=changed);self.apply(2);result=self.execute('rolled-grid',experiment_type='scenario-ab')
        self.assertTrue(any(c['parameter']=='sampled' and c['affectsPrediction'] for c in result['snapshot']['scenarioChanges']));self.assertTrue(any(abs(c['median_delta_db'])>.1 for c in result['comparisons']))
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.save_scenario(db,'toronto','p',dict(id='grid-study',action='baseline',expectedRevision=2))
        plain=deepcopy(self.port);plain.pop('sampled');plain.update(pattern='element',gainDbi=8);self.save(revision=2,port=plain);self.apply(3);result=self.execute('grid-vs-reference',experiment_type='scenario-ab');self.assertEqual(result['snapshot']['predictionModel'],'uma-source-patterns-fixed-heights-v5')

if __name__=='__main__':unittest.main()
