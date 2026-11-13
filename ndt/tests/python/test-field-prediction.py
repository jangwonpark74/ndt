"""Frozen observed-cell predictions reuse all source-model physics at actual GPS."""
from copy import deepcopy
import importlib.util,math
from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.dm.field_prediction import prepare_field_predictor
spec=importlib.util.spec_from_file_location('field_reference_vectors',Path(__file__).parents[1]/'fixtures/rf-review-vectors.py')
fixtures=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixtures)

class FieldPrediction(unittest.TestCase):
    def test_source_cell_and_grid_versions_reproduce_each_frozen_position(self):
        for run in fixtures.vectors():
            if run['context']['model'] not in ('uma-source-cells-fixed-heights-v4','uma-source-patterns-fixed-heights-v5'):continue
            prepared=prepare_field_predictor(run['context'])
            for row in run['rows']:
                value=prepared.at('CELL:cell-1',[row['longitude'],row['latitude']])
                if 'predicted_rx_dbm' in row:self.assertAlmostEqual(value['rxDbm'],row['predicted_rx_dbm'],places=8)
                else:self.assertIsNone(value['rxDbm'])

    def test_an_observed_weaker_cell_is_not_replaced_by_the_model_strongest(self):
        context=deepcopy(next(r['context'] for r in fixtures.vectors() if r['context']['model']=='uma-source-cells-fixed-heights-v4'))
        original=prepare_field_predictor(context).at('CELL:cell-1',[-79.4,43.71])['rxDbm']
        other=deepcopy(context['transmitters'][0]);other.update(id='CELL:other',cellId='other',site_id='OTHER-SITE')
        for p in other['ports']:p['template']['equipmentSource']['cellId']='other'
        context['transmitters'].append(other);context['powers']['CELL:other']=context['powers']['CELL:cell-1']+3
        context['radioScenario']['payload']['radioBudgets']['radio-1']=80
        prepared=prepare_field_predictor(context)
        self.assertAlmostEqual(prepared.at('CELL:cell-1',[-79.4,43.71])['rxDbm'],original,places=9)
        self.assertAlmostEqual(prepared.at('CELL:other',[-79.4,43.71])['rxDbm'],original+3,places=9)
        with self.assertRaises(ValueError):prepared.at('missing',[-79.4,43.71])

    def test_receiver_projection_and_complete_cell_gates_are_retained(self):
        context=deepcopy(next(r['context'] for r in fixtures.vectors() if r['context']['model']=='uma-source-cells-fixed-heights-v4'))
        context.update(predictionModel='uma-los-receiver-fixed-heights-v6',model='uma-los-receiver-fixed-heights-v6',
            receiverAssumptions={'model':'ndt.receiver.los-model2.v1'})
        context['radioScenario']['payload']['receiver']={'model':'ndt.receiver.los-model2.v1','collection':'single-linear','orientation':dict(azimuthDeg=0,tiltDeg=0,rollDeg=0,slantDeg=90)}
        for p in context['transmitters'][0]['ports']:
            p['template'].update(mode='LOS',tiltDeg=0,polarization=dict(model='3gpp-38.901-model2',slantDeg=0,rollDeg=0))
        prepared=prepare_field_predictor(context)
        self.assertEqual(prepared.at('CELL:cell-1',[-79.4,43.701])['status'],'near-field')
        zero=prepared.at('CELL:cell-1',[-79.4,43.71]);self.assertIsNone(zero['rxDbm']);self.assertTrue(zero['zeroCollectedPower'])
        context['transmitters'][0]['ports'][1]['template']['polarization']['slantDeg']=90
        value=prepare_field_predictor(context).at('CELL:cell-1',[-79.4,43.71]);self.assertTrue(math.isfinite(value['rxDbm']))

if __name__=='__main__':unittest.main()
