"""Directional route behavior and reference-element parity, before run integration."""
from copy import deepcopy
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.dm.antenna import element_attenuation,initial_bearing
from backend.dm.simulation import simulate,model_for,MODEL,DIRECTIONAL_MODEL

TEMPLATE=dict(rat='NR',frequencyMHz=3600,bandwidthMHz=100,powerDbm=40,gainDbi=8,lossDb=2,
              azimuthDeg=0,tiltDeg=6,pattern='element',mode='NLOS')

class DirectionalRadio(unittest.TestCase):
    def run_route(self,snapshot,powers=None):
        return simulate(snapshot,dict(speedKmh=40),powers or {'a':46,'b':46},interval_s=1,rat='NR',mode='NLOS',time_origin=0,cancelled=lambda:False)

    def snapshot(self):
        return dict(schema='ndt.execution.v2',predictionModel=DIRECTIONAL_MODEL,radioScenario=dict(id='study',revision=1),
                    route=dict(id='r',coordinates=[[0,0],[0,.002]]),
                    transmitters=[dict(id='a',coordinates=[0,-.001],frequency_mhz=3600,template=deepcopy(TEMPLATE)),
                                  dict(id='b',coordinates=[0,.003],frequency_mhz=3600,template={**TEMPLATE,'azimuthDeg':180})])

    def test_rotation_changes_the_affected_sector_and_zero_change_pairs_agree(self):
        snapshot=self.snapshot();a=self.run_route(snapshot);b=self.run_route(snapshot)
        self.assertEqual(a,b);self.assertEqual(model_for(snapshot),DIRECTIONAL_MODEL)
        self.assertEqual(a[0]['cell_id'],'PLAN:a');self.assertEqual(a[-1]['cell_id'],'PLAN:b')
        rotated=deepcopy(snapshot);rotated['transmitters'][0]['template']['azimuthDeg']=180
        after=self.run_route(rotated)
        self.assertLess(after[0]['predicted_rx_dbm'],a[0]['predicted_rx_dbm']-10)
        self.assertAlmostEqual(after[-1]['predicted_rx_dbm'],a[-1]['predicted_rx_dbm'])
        self.assertEqual(after[-1]['cell_id'],'PLAN:b')

    def test_legacy_runs_ignore_new_template_attributes_and_isotropic_ignores_tilt(self):
        legacy=self.snapshot();del legacy['radioScenario'];legacy['schema']='ndt.execution.v1';legacy['predictionModel']=MODEL
        before=self.run_route(legacy);legacy['transmitters'][0]['template']['azimuthDeg']=180
        self.assertEqual(before,self.run_route(legacy));self.assertEqual(model_for(legacy),MODEL)
        omni=self.snapshot()
        for t in omni['transmitters']:t['template'].update(pattern='isotropic',gainDbi=0)
        before=self.run_route(omni)
        for t in omni['transmitters']:t['template'].update(tiltDeg=45,azimuthDeg=270)
        self.assertEqual(before,self.run_route(omni))

    def test_unknown_frozen_model_is_never_silently_reinterpreted(self):
        snapshot=self.snapshot();snapshot['predictionModel']='unavailable-model-v99'
        with self.assertRaisesRegex(ValueError,'model'):self.run_route(snapshot)

    def test_reference_element_and_geographic_bearing(self):
        for args,expected in [((0,0,0),0),((32.5,0,0),3),((180,0,0),30),((0,-6,6),0)]:
            self.assertAlmostEqual(element_attenuation(*args),expected)
        for point,expected in [([0,.01],0),([.01,0],90),([0,-.01],180),([-.01,0],270)]:
            self.assertAlmostEqual(initial_bearing([0,0],point),expected)
        vectors=[[az,elevation,tilt] for az in [-360,-180,-65,0,32.5,65,180,360] for elevation in [-90,-20,-6,0,20,90] for tilt in [-20,0,6,90]]
        code="import {elementAttenuation} from './dist/planning-model.mjs';let raw='';for await(const p of process.stdin)raw+=p;console.log(JSON.stringify(JSON.parse(raw).map(p=>elementAttenuation(...p))));"
        result=subprocess.run(['node','--input-type=module','-e',code],input=json.dumps(vectors),text=True,capture_output=True,cwd=Path(__file__).resolve().parents[2],check=True)
        for values,expected in zip(vectors,json.loads(result.stdout)):
            self.assertAlmostEqual(element_attenuation(*values),expected,places=10,msg=str(values))

if __name__=='__main__':unittest.main()
