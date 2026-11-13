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
    def test_array_validation_power_nulls_and_cross_language_parity(self):
        from backend.dm.antenna import array_attenuation,peak_eirp
        from backend.radio_scenarios import validate_radio_template
        template={**TEMPLATE,'pattern':'array','tiltDeg':0,'array':dict(rows=4,columns=4,verticalSpacing=.5,horizontalSpacing=.5,steerAzimuthDeg=0,steerDowntiltDeg=0)}
        validate_radio_template(template)
        self.assertAlmostEqual(peak_eirp(template),46+10*math.log10(16))
        self.assertAlmostEqual(array_attenuation(template,0,0),0)
        self.assertAlmostEqual(array_attenuation(template,30,0),120)
        for change in [dict(rows=True),dict(rows=1.5),dict(rows=65),dict(verticalSpacing=0),dict(horizontalSpacing=float('nan')),dict(steerAzimuthDeg=91),dict(extra=0)]:
            with self.subTest(change=change),self.assertRaises(ValueError):validate_radio_template({**template,'array':{**template['array'],**change}})
        with self.assertRaises(ValueError):validate_radio_template({**template,'pattern':'element'})
        vectors=[]
        for rows,columns in [(1,1),(1,8),(4,4),(64,64)]:
            for tilt in [0,6,90]:
                for az,elev in [(0,0),(30,0),(65,-6),(180,-20),(-35,15)]:
                    t={**template,'tiltDeg':tilt,'array':{**template['array'],'rows':rows,'columns':columns,'steerAzimuthDeg':-20,'steerDowntiltDeg':10}}
                    vectors.append([t,az,elev])
        code="import {arrayAttenuation,peakEirp} from './dist/planning-model.mjs';let raw='';for await(const p of process.stdin)raw+=p;console.log(JSON.stringify(JSON.parse(raw).map(p=>[arrayAttenuation(...p),peakEirp(p[0])])));"
        result=subprocess.run(['node','--input-type=module','-e',code],input=json.dumps(vectors),text=True,capture_output=True,cwd=Path(__file__).resolve().parents[2],check=True)
        for args,expected in zip(vectors,json.loads(result.stdout)):
            self.assertAlmostEqual(array_attenuation(*args),expected[0],places=8)
            self.assertAlmostEqual(peak_eirp(args[0]),expected[1],places=10)

    def test_array_runs_require_new_identity_and_use_normalized_gain_once(self):
        from backend.dm.model_versions import ARRAY_UMA
        from backend.dm.antenna import peak_eirp
        snapshot=self.snapshot();snapshot['transmitters']=snapshot['transmitters'][:1]
        before=self.run_route(snapshot)
        template=snapshot['transmitters'][0]['template']
        template.update(pattern='array',array=dict(rows=1,columns=4,verticalSpacing=.5,horizontalSpacing=.5,steerAzimuthDeg=0,steerDowntiltDeg=0))
        with self.assertRaisesRegex(ValueError,'model'):self.run_route(snapshot)
        snapshot['predictionModel']=ARRAY_UMA
        after=self.run_route(snapshot,{'a':peak_eirp(template)})
        self.assertAlmostEqual(after[0]['predicted_rx_dbm']-before[0]['predicted_rx_dbm'],10*math.log10(4),places=8)
        template['array']['steerAzimuthDeg']=30
        self.assertLess(self.run_route(snapshot,{'a':peak_eirp(template)})[0]['predicted_rx_dbm'],after[0]['predicted_rx_dbm']-20)

    def test_array_far_field_boundary_and_low_power_output_remain_explicit(self):
        from backend.dm.model_versions import ARRAY_UMA
        from backend.dm.antenna import array_far_field_distance,peak_eirp,array_attenuation
        snapshot=self.snapshot();snapshot['predictionModel']=ARRAY_UMA;snapshot['transmitters']=snapshot['transmitters'][:1]
        t=snapshot['transmitters'][0]['template'];t.update(pattern='array',array=dict(rows=64,columns=64,verticalSpacing=1,horizontalSpacing=1,steerAzimuthDeg=0,steerDowntiltDeg=0))
        self.assertAlmostEqual(array_far_field_distance(t),2*(63**2+63**2)*(3e8/(3600e6)))
        rows=self.run_route(snapshot,{'a':peak_eirp(t)})
        self.assertTrue(all('predicted_rx_dbm' not in r for r in rows));self.assertIn('far-field',rows[0]['event'])
        # Independent coherent-sum oracle checks weight power and phase convention.
        import cmath
        t['tiltDeg']=0;t['array'].update(rows=3,columns=5,verticalSpacing=.7,horizontalSpacing=.4,steerAzimuthDeg=20,steerDowntiltDeg=10)
        y=math.cos(math.radians(-12))*math.sin(math.radians(35));z=math.sin(math.radians(-12))
        sy=math.cos(math.radians(-10))*math.sin(math.radians(20));sz=math.sin(math.radians(-10))
        weights=[cmath.exp(-2j*math.pi*(m*.7*sz+n*.4*sy))/math.sqrt(15) for m in range(3) for n in range(5)]
        self.assertAlmostEqual(sum(abs(w)**2 for w in weights),1)
        response=sum(w*cmath.exp(2j*math.pi*(m*.7*z+n*.4*y)) for w,(m,n) in zip(weights,[(m,n) for m in range(3) for n in range(5)]))
        self.assertAlmostEqual(array_attenuation(t,35,-12),min(120,-10*math.log10(abs(response)**2/15)),places=9)
        t.update(tiltDeg=0,frequencyMHz=100000,array=dict(rows=1,columns=4,verticalSpacing=.5,horizontalSpacing=.5,steerAzimuthDeg=30,steerDowntiltDeg=0))
        snapshot['route']['coordinates']=[[0,.04],[0,.041]];snapshot['transmitters'][0]['coordinates']=[0,0]
        rows=self.run_route(snapshot,{'a':0})
        self.assertTrue(all('predicted_rx_dbm' not in r for r in rows));self.assertIn('-300 dBm',rows[0]['event'])

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
