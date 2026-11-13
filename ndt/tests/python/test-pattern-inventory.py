"""Source revision, declared hardware and scalar-pattern binding contracts."""
from copy import deepcopy
import json,math,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.equipment_inventory import validate_inventory,trace_cell
from backend.pattern_studies import qualify_grid,pattern_summaries
from backend.pattern_models import GRID_MODEL,FIELDS
BASE=Path(__file__).parents[1]/'fixtures'
GRID=json.loads((BASE/'scalar-pattern-grid.json').read_text(encoding='utf8'))
EXAMPLE=json.loads((BASE/'equipment-example.json').read_text(encoding='utf8'))

class PatternInventory(unittest.TestCase):
    def sample(self):
        data=deepcopy(EXAMPLE);data['schemaVersion']=2;data['patterns'][0]['radiation']=deepcopy(GRID);return data
    def inventory(self,data):return dict(revision=1,sha256='a'*64,data=data)
    def template(self):return dict(pattern='sampled',frequencyMHz=3600,bandwidthMHz=100,gainDbi=10*math.log10(1.5),tiltDeg=0,sampled=dict(format=GRID_MODEL,patternId='pattern-1',rollDeg=0),equipmentSource=dict(revision=1,sha256='a'*64,cellId='cell-1',linkId='link-1'))
    def path(self,data):
        trace=trace_cell(data,'cell-1');return dict(trace=trace,connection=trace['connections'][0])

    def test_v2_radiation_only_models_and_numerical_summaries_are_explicit(self):
        data=self.sample();del data['patterns'][0]['horizontal'];del data['patterns'][0]['vertical'];validate_inventory(data,{'TEST-SITE'})
        models=pattern_summaries(data);self.assertEqual(len(models),1);self.assertEqual(models[0]['patternId'],'pattern-1');self.assertEqual(models[0]['sampleCount'],30)
        self.assertEqual(models[0]['evidence'],'analytical-test');self.assertFalse(models[0]['independentlyVerified']);self.assertAlmostEqual(models[0]['efficiencies'][0],.1+1/math.pi)
        g=qualify_grid(self.inventory(data),self.path(data),self.template());self.assertAlmostEqual(g.gain(3600,45,45),.75)

    def test_schema_contract_and_total_import_sample_budget(self):
        schema=json.loads((Path(__file__).parents[2]/'dist/equipment-format.json').read_text(encoding='utf8'))
        contract=schema['$defs']['scalarGainGrid']
        self.assertEqual(set(contract['required']),FIELDS)
        self.assertEqual(set(contract['properties']),FIELDS)
        self.assertEqual(schema['properties']['schemaVersion']['enum'],[1,2])
        data=self.sample();grid=data['patterns'][0]['radiation']
        grid['azimuthDeg']=[-180+i*360/250 for i in range(251)]
        grid['elevationDeg']=[-90+i*180/250 for i in range(251)]
        grid['gainDbi']=[[[0]*251 for _ in range(251)] for _ in range(2)]
        data['patterns'].append({**deepcopy(data['patterns'][0]),'id':'second'})
        with self.assertRaisesRegex(ValueError,'250000 total samples'):validate_inventory(data,{'TEST-SITE'})

    def test_v1_does_not_reinterpret_unknown_new_model_fields(self):
        data=deepcopy(EXAMPLE);validate_inventory(data,{'TEST-SITE'});self.assertEqual(pattern_summaries(data),[])
        data['patterns'][0]['radiation']=deepcopy(GRID)
        with self.assertRaisesRegex(ValueError,'schemaVersion 2'):validate_inventory(data,{'TEST-SITE'})
        self.assertEqual(pattern_summaries(data),[],'historic schema v1 extra fields are never promoted into execution models')
        with self.assertRaisesRegex(ValueError,'schemaVersion 2'):qualify_grid(self.inventory(data),self.path(data),self.template())

    def test_declared_hardware_port_frequency_and_stored_gain_must_match(self):
        data=self.sample();validate_inventory(data,{'TEST-SITE'})
        for change,issue in [('model','model'),('port','port'),('coverage','coverage'),('gain','gain'),('pattern','pattern'),('revision','source')]:
            d=deepcopy(data);t=self.template()
            if change=='model':d['antennas'][0]['model']='Other antenna'
            if change=='port':d['ports'][1]['name']='Unreported port'
            if change=='coverage':t['frequencyMHz']=3500
            if change=='gain':t['gainDbi']+=1
            if change=='pattern':t['sampled']['patternId']='unlinked'
            if change=='revision':t['equipmentSource']['revision']=2
            with self.subTest(change=change),self.assertRaisesRegex(ValueError,issue):qualify_grid(self.inventory(d),self.path(d),t)

    def test_port_specific_models_override_antenna_fallback_without_inferring_links(self):
        data=self.sample();data['patterns'].append({**deepcopy(data['patterns'][0]),'id':'port-pattern'});data['ports'][1]['patternId']='port-pattern'
        validate_inventory(data,{'TEST-SITE'});self.assertEqual(self.path(data)['connection']['pattern']['id'],'port-pattern')
        t=self.template();t['sampled']['patternId']='port-pattern';qualify_grid(self.inventory(data),self.path(data),t)
        data['ports'][0]['patternId']='pattern-1'
        with self.assertRaisesRegex(ValueError,'antenna port'):validate_inventory(data,{'TEST-SITE'})

    def test_malformed_grids_and_partial_cuts_fail_without_replacing_evidence(self):
        for change in ['seam','passivity','shape','one-cut','missing-port-pattern']:
            data=self.sample()
            if change=='seam':data['patterns'][0]['radiation']['gainDbi'][0][1][-1]-=1
            if change=='passivity':data['patterns'][0]['radiation']['gainDbi']=[[[3]*5 for _ in range(3)] for _ in range(2)]
            if change=='shape':data['patterns'][0]['radiation']['gainDbi'][0].pop()
            if change=='one-cut':del data['patterns'][0]['horizontal']
            if change=='missing-port-pattern':data['ports'][1]['patternId']='missing'
            with self.subTest(change=change),self.assertRaises(ValueError):validate_inventory(data,{'TEST-SITE'})

if __name__=='__main__':unittest.main()
