"""Versioned receiver study templates and complete-cell zero-power behavior."""
from copy import deepcopy
from pathlib import Path
import math
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.radio_templates import validate_radio_template
from backend.dm.simulation import simulate, model_for
from backend.dm.polarization import RECEIVER_MODEL

TEMPLATE = dict(rat='NR', frequencyMHz=3600, bandwidthMHz=100, powerDbm=30, gainDbi=0,
                lossDb=0, azimuthDeg=0, tiltDeg=0, pattern='isotropic', mode='LOS',
                polarization=dict(model='3gpp-38.901-model2', slantDeg=0, rollDeg=0))
RECEIVER = dict(model=RECEIVER_MODEL, collection='single-linear',
                orientation=dict(azimuthDeg=0, tiltDeg=0, rollDeg=0, slantDeg=90))
MODEL = 'uma-los-receiver-fixed-heights-v6'


class ReceiverStudies(unittest.TestCase):
    def test_roll_rotates_a_known_four_element_array_null(self):
        from backend.dm.antenna import receiver_antenna_attenuation
        t=deepcopy(TEMPLATE)|dict(pattern='array',array=dict(rows=1,columns=4,verticalSpacing=.5,
            horizontalSpacing=.5,steerAzimuthDeg=0,steerDowntiltDeg=0))
        # Four half-wavelength horizontal elements: first null at sin(angle)=1/2.
        self.assertGreater(receiver_antenna_attenuation(t,30,0),120)
        self.assertLess(receiver_antenna_attenuation(t,0,30),10)
        t['polarization']['rollDeg']=90
        self.assertGreater(receiver_antenna_attenuation(t,0,30),120)
        self.assertLess(receiver_antenna_attenuation(t,30,0),10)

    def test_template_requires_explicit_los_and_unambiguous_geometry(self):
        validate_radio_template(TEMPLATE)
        for change in [dict(mode='NLOS'), dict(polarization=None),
                       dict(polarization={**TEMPLATE['polarization'], 'phaseDeg': 0}),
                       dict(polarization={**TEMPLATE['polarization'], 'rollDeg': True})]:
            with self.assertRaises(ValueError):
                validate_radio_template(TEMPLATE | change)

    def snapshot(self, collection='single-linear'):
        return dict(schema='ndt.execution.v6', predictionModel=MODEL,
                    radioScenario=dict(payload=dict(receiver=deepcopy(RECEIVER) | dict(collection=collection))),
                    receiverAssumptions=dict(model=RECEIVER_MODEL),
                    route=dict(id='r', coordinates=[[0, 0], [0, .002]]),
                    transmitters=[dict(id='site', coordinates=[0, -.001], template=deepcopy(TEMPLATE))])

    def run_route(self, snapshot):
        return simulate(snapshot, dict(speedKmh=40), {'site': 30}, interval_s=1, rat='NR', mode='LOS',
                        time_origin=0, cancelled=lambda: False)

    def test_new_identity_and_zero_power_have_no_finite_dbm(self):
        snap = self.snapshot()
        self.assertEqual(model_for(snap), MODEL)
        self.assertTrue(all('predicted_rx_dbm' not in row for row in self.run_route(snap)))
        with self.assertRaisesRegex(ValueError, 'receiver|polarization|model'):
            self.run_route(snap | dict(predictionModel='uma-source-cells-fixed-heights-v4'))
        with self.assertRaisesRegex(ValueError, 'receiver|qualification|assumptions'):
            self.run_route({k: v for k, v in snap.items() if k != 'receiverAssumptions'})

    def test_declared_null_receiver_is_not_an_implicit_scalar_baseline(self):
        snap=self.snapshot()
        snap['radioScenario']['payload']['receiver']=None
        del snap['transmitters'][0]['template']['polarization']
        with self.assertRaisesRegex(ValueError,'receiver|explicit'):
            self.run_route(snap)

    def test_dual_collection_preserves_scalar_power(self):
        snap = self.snapshot('dual-orthogonal')
        rows = self.run_route(snap)
        self.assertTrue(all(math.isfinite(row['predicted_rx_dbm']) for row in rows))
        old = deepcopy(snap)
        old['predictionModel'] = 'uma-source-cells-fixed-heights-v4'
        del old['receiverAssumptions']
        del old['radioScenario']['payload']['receiver']
        del old['transmitters'][0]['template']['polarization']
        self.assertEqual(rows, self.run_route(old))

    def test_a_zero_power_port_does_not_invalidate_a_complete_cell(self):
        from backend.cell_assignments import cell_eirp
        from backend.dm.simulation import path_loss
        from backend.dm.integration import distance
        snap=self.snapshot()
        tx=snap['transmitters'][0]
        tx.update(rat='NR',cellId='cell',ports=[dict(linkId='v',radioId='radio',template=deepcopy(TEMPLATE)),
            dict(linkId='h',radioId='radio',template={**deepcopy(TEMPLATE),'powerDbm':5,
                'polarization':{**TEMPLATE['polarization'],'slantDeg':90}})])
        del tx['template']
        for port in tx['ports']:
            port['template']['equipmentSource']=dict(revision=1,sha256='a'*64,cellId='cell',linkId=port['linkId'])
        snap['radioScenario']['payload']['radioBudgets']={'radio':40}
        rows=simulate(snap,dict(speedKmh=40),{'site':cell_eirp(tx)},interval_s=1,rat='NR',mode='LOS',time_origin=0,cancelled=lambda:False)
        for row in rows:
            expected=5-path_loss(distance(tx['coordinates'],[row['longitude'],row['latitude']]),3600,'LOS')
            self.assertAlmostEqual(row['predicted_rx_dbm'],expected,places=10)


if __name__ == '__main__':
    unittest.main()
