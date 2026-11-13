"""Pinned 3GPP subset checks; JS/Python accept the same qualified templates."""
import json
from pathlib import Path
import subprocess
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.carrier_plan import carrier_frequency,validate_carrier
from backend.radio_scenarios import validate_radio_template

class CarrierPlan(unittest.TestCase):
    def template(self):
        return dict(rat='NR',frequencyMHz=3600,bandwidthMHz=100,powerDbm=40,gainDbi=8,lossDb=2,
                    tiltDeg=6,azimuthDeg=0,pattern='element',mode='NLOS',
                    carrier=dict(standard='3gpp-rel18-carrier-subset-v1',band='n78',channel=640000,scsKHz=30))

    def test_channel_conversion_validation_and_legacy_templates(self):
        self.assertEqual(carrier_frequency('B4',2250),2140)
        self.assertEqual(carrier_frequency('n78',640000),3600)
        template=self.template();validate_carrier(template);validate_radio_template(template)
        for changes in [dict(frequencyMHz=3500),dict(bandwidthMHz=35),dict(carrier={**template['carrier'],'channel':640001}),
                        dict(carrier={**template['carrier'],'scsKHz':15}),dict(carrier={**template['carrier'],'channel':True})]:
            with self.subTest(changes=changes),self.assertRaises(ValueError):validate_radio_template({**template,**changes})
        del template['carrier'];validate_radio_template(template)
        with self.assertRaisesRegex(ValueError,'Choose a supported band'):validate_carrier(template,required=True)

    def test_python_js_parity_at_raster_and_bandwidth_boundaries(self):
        template=self.template();cases=[]
        for band,channels in [('B2',[599,600,700,900,1199,1200]),('B4',[1950,2050,2250,2399]),('B7',[2750,2850,3100,3449]),
                              ('n41',[499200,499201,520002,537996]),('n77',[620000,640000,660000,680000]),('n78',[620000,620002,640000,653332,653333])]:
            for channel in channels:
                for bandwidth in [5,20,35,100]:
                    rat='LTE' if band.startswith('B') else 'NR'
                    cases.append({**template,'rat':rat,'frequencyMHz':carrier_frequency(band,channel),'bandwidthMHz':bandwidth,
                                  'carrier':{**template['carrier'],'band':band,'channel':channel,'scsKHz':15 if rat=='LTE' else 30}})
        for value in [640000.0,True,None,'640000',640000.5,10**400]:
            cases.append({**self.template(),'carrier':{**self.template()['carrier'],'channel':value}})
        code="import {validateCarrier} from './dist/carrier-plan.mjs';let raw='';for await(const part of process.stdin)raw+=part;console.log(JSON.stringify(JSON.parse(raw).map(t=>validateCarrier(t))));"
        result=subprocess.run(['node','--input-type=module','-e',code],input=json.dumps(cases),text=True,capture_output=True,cwd=Path(__file__).resolve().parents[2],check=True)
        messages=json.loads(result.stdout)
        for template,message in zip(cases,messages):
            try:validate_carrier(template);actual=''
            except ValueError as error:actual=str(error)
            self.assertEqual(actual,message,template)

    def test_oversized_numeric_json_is_a_validation_error(self):
        for field in ['frequencyMHz','bandwidthMHz','powerDbm','gainDbi']:
            with self.subTest(field=field),self.assertRaises(ValueError):validate_radio_template({**self.template(),field:10**400})
        template=self.template();template['carrier']['channel']=10**400
        with self.assertRaises(ValueError):validate_carrier(template)

if __name__=='__main__':unittest.main()
