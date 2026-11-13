"""Independent scalar-pattern oracles; no measured field-accuracy claim."""
from copy import deepcopy
import json,math,unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.pattern_models import ScalarGainGrid,local_direction

RAW=json.loads((Path(__file__).parents[1]/'fixtures/scalar-pattern-grid.json').read_text(encoding='utf8'))

class PatternModels(unittest.TestCase):
    def test_linear_power_interpolation_frequency_angles_and_peak_bound(self):
        g=ScalarGainGrid(RAW)
        self.assertAlmostEqual(g.gain(3600,45,45),.75,places=12)
        self.assertAlmostEqual(g.gain(3600,45,0),1.35,places=12)
        self.assertAlmostEqual(g.gain(3600,-45,0),1.05,places=12)
        self.assertAlmostEqual(g.peak_gain_dbi(3600),10*math.log10(1.5),places=12)
        self.assertAlmostEqual(g.attenuation(3600,45,45),10*math.log10(2),places=12)
        self.assertAlmostEqual(g.gain(3600,179,20),g.gain(3600,-181,20),places=12)
        for phi in [-900,-180,-61,0,90,180,790]:
            self.assertAlmostEqual(g.gain(3600,phi,90),.15,places=12)
        g.check_carrier(3600,100)
        self.assertAlmostEqual(g.far_field_m(3600),24,places=12)

    def test_exact_spherical_integral_matches_independent_closed_form(self):
        g=ScalarGainGrid(RAW)
        self.assertAlmostEqual(g.efficiencies[0],.1+1/math.pi,places=12)
        self.assertAlmostEqual(g.efficiencies[1],.2+2/math.pi,places=12)
        constant=deepcopy(RAW);constant['gainDbi']=[[[0]*5 for _ in range(3)] for _ in range(2)]
        self.assertTrue(all(abs(e-1)<1e-12 for e in ScalarGainGrid(constant).efficiencies))
        constant['gainDbi'][0]=[[3]*5 for _ in range(3)]
        with self.assertRaisesRegex(ValueError,'passive|efficiency|power'):ScalarGainGrid(constant)

    def test_nonuniform_axes_use_actual_angle_intervals(self):
        value=deepcopy(RAW);value['azimuthDeg']=[-180,-20,0,70,180]
        g=ScalarGainGrid(value)
        self.assertAlmostEqual(g.gain(3500,35,0),.9,places=12)
        self.assertAlmostEqual(g.gain(3500,-10,0),.7,places=12)

    def test_frequency_peak_is_an_upper_bound_when_the_lobe_moves(self):
        value=deepcopy(RAW)
        value['gainDbi'][1][1]=[10*math.log10(p) for p in [.4,.8,1.6,2,.4]]
        g=ScalarGainGrid(value)
        self.assertAlmostEqual(g.peak_gain_dbi(3600),10*math.log10(1.5),places=12)
        self.assertAlmostEqual(max(g.gain(3600,a,0) for a in g.azimuth),1.4,places=12)
        self.assertAlmostEqual(g.peak_gain_dbi(3600)-g.attenuation(3600,90,0),10*math.log10(1.4),places=12)

    def test_sample_limit_precedes_shape_allocation(self):
        value=deepcopy(RAW)
        value['azimuthDeg']=list(range(-180,181));value['elevationDeg']=list(range(-90,91))
        value['frequencyMHz']=[3500,3550,3600,3650]
        with self.assertRaisesRegex(ValueError,'250000 samples'):ScalarGainGrid(value)

    def test_bad_axes_samples_and_conventions_are_rejected_without_normalizing(self):
        changes=[('coordinateSystem','unknown'),('referenceImpedanceOhm',None),('referenceImpedanceOhm','50+j10'),('portConditions','unknown'),('maxDimensionM',10**400),('referencePlane','accepted-power'),('interpolation','dB-linear'),('evidence','verified'),('portNames',[]),('portNames',['P1','P1']),('maxDimensionM',0),('maxDimensionM',True),('electricalTiltDeg',None),('frequencyMHz',[3500]),('azimuthDeg',[-180,0,0,180]),('elevationDeg',[-80,0,90])]
        for key,value in changes:
            with self.subTest(key=key,value=value):
                invalid=deepcopy(RAW);invalid[key]=value
                with self.assertRaises(ValueError):ScalarGainGrid(invalid)
        for invalid in [None,{},dict(RAW,extra=0)]:
            with self.assertRaises(ValueError):ScalarGainGrid(invalid)
        for kind in ['seam','pole','nan','bool','size']:
            invalid=deepcopy(RAW)
            if kind=='seam':invalid['gainDbi'][0][1][-1]-=1
            if kind=='pole':invalid['gainDbi'][0][0][1]-=1
            if kind=='nan':invalid['gainDbi'][0][1][1]=float('nan')
            if kind=='bool':invalid['gainDbi'][0][1][1]=False
            if kind=='size':invalid['gainDbi'][0][1].pop()
            with self.subTest(kind=kind),self.assertRaises(ValueError):ScalarGainGrid(invalid)

    def test_carrier_coverage_and_queries_do_not_extrapolate(self):
        g=ScalarGainGrid(RAW)
        for f,bw in [(3500,1),(3700,1),(3499,1),(3600,201),(3600,True)]:
            with self.subTest(f=f,bw=bw),self.assertRaises(ValueError):g.check_carrier(f,bw)
        for f,az,el in [(3499,0,0),(3701,0,0),(3600,0,91),(3600,float('nan'),0),(True,0,0)]:
            with self.subTest(f=f,az=az,el=el),self.assertRaises(ValueError):g.gain(f,az,el)

    def test_mechanical_downtilt_is_a_rigid_direction_rotation(self):
        self.assertAlmostEqual(local_direction(0,-20,20)[0],0,places=11)
        self.assertAlmostEqual(local_direction(0,-20,20)[1],0,places=11)
        for tilt in [-20,0,40,90]:
            az,el=local_direction(90,0,tilt);self.assertAlmostEqual(az,90,places=11);self.assertAlmostEqual(el,0,places=11)
        az,el=local_direction(0,30,0,90);self.assertAlmostEqual(az,-30);self.assertAlmostEqual(el,0)
        az,el=local_direction(0,0,30);self.assertAlmostEqual(az,0);self.assertAlmostEqual(el,30)

if __name__=='__main__':unittest.main()
