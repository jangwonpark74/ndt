"""TDD contracts for frozen replay, per-row QC and disjoint calibration."""
from copy import deepcopy
import importlib.util,json
from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.dm.field_study import prepare_study,run_study
from backend.dm.integration import digest
spec=importlib.util.spec_from_file_location('field_study_inputs',Path(__file__).parents[1]/'fixtures/field-inputs.py')
fixtures=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixtures)

class FieldStudy(unittest.TestCase):
    def setUp(self):self.capture,self.prediction,self.descriptor,self.options=fixtures.multisite_inputs()
    def prepare(self):return prepare_study(self.capture,self.prediction,json.dumps(self.descriptor),self.options)
    def test_frozen_replay_and_analytic_bias_on_earlier_disjoint_sites_lte_and_nr(self):
        for rat in ['LTE','NR']:
            with self.subTest(rat=rat):
                self.capture,self.prediction,self.descriptor,self.options=fixtures.multisite_inputs(rat)
                before=deepcopy((self.capture,self.prediction,self.descriptor,self.options));snapshot=self.prepare()
                result=run_study(snapshot)
                self.assertEqual(before,(self.capture,self.prediction,self.descriptor,self.options))
                self.assertEqual(result['status'],'diagnostic-complete')
                self.assertEqual(result['quality']['eligible'],128)
                self.assertEqual(result['replay']['rows'],len(self.prediction['rows']))
                self.assertLessEqual(result['replay']['maxAbsoluteError'],1e-7)
                self.assertAlmostEqual(result['calibration']['offsetDb'],3,places=8)
                self.assertAlmostEqual(result['calibration']['holdout']['raw']['rmseDb'],6,places=8)
                self.assertAlmostEqual(result['calibration']['holdout']['adjusted']['rmseDb'],3,places=8)
                self.assertFalse(result['independentlyVerified'])
                self.assertEqual(len(result['observations']),128)
                self.assertEqual({b['siteId'] for b in result['calibration']['bins'] if b['partition']=='training'},{'SITE-0','SITE-1'})
    def test_measurement_quality_range_carrier_and_missing_data_are_counted_not_clamped(self):
        changes=[('below-floor',lambda r:r.update(measurement_status='below-floor')),('missing-quality',lambda r:r.pop('measurement_status')),
            ('outside-instrument-range',lambda r:r.update(measured_rx_dbm=-190)),('missing-power',lambda r:r.pop('measured_rx_dbm')),
            ('carrier-mismatch',lambda r:r.update(arfcn=640001)),('unmapped-cell',lambda r:r.update(cell_id='unknown')),
            ('missing-gps',lambda r:(r.pop('longitude'),r.pop('latitude'))),('off-route',lambda r:r.update(longitude=-79.42))]
        for row,(reason,change) in zip(self.capture['rows'],changes):change(row)
        result=run_study(self.prepare())
        self.assertEqual(result['quality']['eligible'],120)
        self.assertEqual(result['quality']['excluded'],8)
        self.assertEqual(result['quality']['reasons'],{r:1 for r,_ in changes})
        self.assertEqual([r['reason'] for r in result['observations'][:8]],[r for r,_ in changes])
    def test_low_compatible_percentage_retains_diagnostics_without_fitting_an_offset(self):
        for row in self.capture['rows'][:30]:row['measurement_status']='invalid'
        result=run_study(self.prepare())
        self.assertEqual(result['status'],'insufficient-compatible-data')
        self.assertIsNone(result['calibration']['offsetDb'])
        self.assertEqual(result['quality']['reasons']['invalid'],30)
        self.assertEqual(result['quality']['eligible'],98)
    def test_source_hash_and_frozen_numeric_replay_are_independent_guards(self):
        self.prediction['rows'][5]['predicted_rx_dbm']+=1
        with self.assertRaisesRegex(ValueError,'hash'):self.prepare()
        self.prediction['sha256']=digest(dict(manifest=self.prediction['context'],rows=self.prediction['rows']))
        self.descriptor['predictionSha256']=self.prediction['sha256']
        with self.assertRaisesRegex(ValueError,'replay'):run_study(self.prepare())
    def test_structural_options_incompatible_sources_and_bounded_work_fail_before_queue(self):
        for key,value in [('heldoutSites',[True]),('cutoffT',True),('timeGapMs',-1),('direction','automatic'),('minimumCompatiblePct',101),('toleranceM',0),('gapMs',True)]:
            with self.subTest(key=key):
                saved=self.options[key];self.options[key]=value
                with self.assertRaises(ValueError):self.prepare()
                self.options[key]=saved
        self.descriptor['measurement']['quantity']='nr-ss-rsrp'
        with self.assertRaisesRegex(ValueError,'RSRP'):self.prepare()
        self.descriptor['measurement']['quantity']='desired-carrier-local-mean-power'
        self.prediction['context']['route']['coordinates']*=100001
        with self.assertRaisesRegex(ValueError,'work limit'):self.prepare()
    def test_cancellation_and_progress_cover_route_and_prediction_work(self):
        snapshot=self.prepare();updates=[]
        result=run_study(snapshot,progress=lambda n:updates.append(n))
        self.assertEqual(updates[-1],100);self.assertEqual(updates,sorted(updates))
        calls=0
        def cancelled():
            nonlocal calls
            calls+=1
            return calls>=4
        with self.assertRaises(InterruptedError):run_study(snapshot,cancelled=cancelled)
        self.assertEqual(result['quality']['eligible'],128)

    def test_shared_physical_coordinates_cannot_straddle_the_holdout(self):
        context=self.prediction['context'];context['transmitters'][2]['coordinates']=context['transmitters'][0]['coordinates'][:]
        self.prediction['sha256']=digest(dict(manifest=context,rows=self.prediction['rows']))
        self.descriptor['predictionSha256']=self.prediction['sha256']
        with self.assertRaisesRegex(ValueError,'Co-located'):self.prepare()

    def test_snapshot_digest_and_export_bin_indices_retain_traceability(self):
        snapshot=self.prepare();damaged=deepcopy(snapshot);damaged['capture']['rows'][0]['measured_rx_dbm']+=1
        with self.assertRaisesRegex(ValueError,'input hash'):run_study(damaged)
        self.capture['rows'][0]['measurement_status']='invalid'
        result=run_study(self.prepare());indices=[i for b in result['calibration']['bins'] for i in b['observationIndices']]
        self.assertEqual(sorted(indices),list(range(1,128)))

    def test_frozen_sampled_patterns_and_each_receiver_role_keep_their_own_physics(self):
        import math
        from backend.dm.simulation import simulate
        from backend.dm.field_prediction import prepare_field_predictor
        from backend.pattern_studies import pattern_summaries
        from backend.cell_assignments import cell_eirp
        for model,collection in [('uma-source-patterns-fixed-heights-v5',None),('uma-los-receiver-fixed-heights-v6','single-linear'),('uma-los-receiver-fixed-heights-v6','dual-orthogonal')]:
            with self.subTest(model=model,collection=collection):
                self.setUp();context=self.prediction['context'];context.update(model=model,predictionModel=model)
                if collection:
                    receiver=dict(model='ndt.receiver.los-model2.v1',collection=collection,orientation=dict(azimuthDeg=0,tiltDeg=0,rollDeg=0,slantDeg=0))
                    context['radioScenario']['payload']['receiver']=receiver;context['receiverAssumptions']={'model':'ndt.receiver.los-model2.v1'}
                    self.descriptor['measurement']['receiver']=deepcopy(receiver)
                    for tx in context['transmitters']:tx['ports'][0]['template'].update(mode='LOS',polarization=dict(model='3gpp-38.901-model2',slantDeg=0,rollDeg=0))
                else:
                    equipment=context['inventorySnapshot']['operatorEquipment'];data=json.loads(equipment['raw']);context['patternAssumptions']={'format':'ndt.scalar-gain-grid.v1'}
                    context['patternModels']=[dict(p,equipmentRevision=equipment['revision'],equipmentSha256=equipment['sha256']) for p in pattern_summaries(data,source_sha=equipment['sha256'])]
                    for i,tx in enumerate(context['transmitters']):tx['ports'][0]['template'].update(pattern='sampled',gainDbi=10*math.log10(1.5),tiltDeg=0,sampled=dict(format='ndt.scalar-gain-grid.v1',patternId=f's{i}-pattern-1',rollDeg=12))
                context['powers']={tx['id']:cell_eirp(tx) for tx in context['transmitters']}
                self.prediction['rows']=simulate(context,context['case'],context['powers'],interval_s=context['interval_s'],rat='NR',mode=context['mode'],time_origin=context['time_origin'],cancelled=lambda:False)
                self.prediction['sha256']=digest(dict(manifest=context,rows=self.prediction['rows']));self.descriptor['predictionSha256']=self.prediction['sha256']
                prepared=prepare_field_predictor(context)
                for i,row in enumerate(self.capture['rows']):row['measured_rx_dbm']=prepared.at(self.descriptor['cells'][i//32]['transmitterId'],[row['longitude'],row['latitude']])['rxDbm']+(3 if i<64 else 6)
                result=run_study(self.prepare());self.assertEqual(result['status'],'diagnostic-complete');self.assertAlmostEqual(result['calibration']['offsetDb'],3,places=8)

if __name__=='__main__':unittest.main()
