"""Same-origin field-study APIs, bounded JSON, explicit checks and export."""
from contextlib import closing
import http.client,importlib.util,json,tempfile,threading,uuid,zlib
from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend import server
from backend.dm.http import DriveTestService
from backend.dm.dm_model import connection
from backend.dm.integration import canonical
spec=importlib.util.spec_from_file_location('field_http_inputs',Path(__file__).parents[1]/'fixtures/field-inputs.py')
fixtures=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixtures)

class FieldHTTP(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.planning=Path(self.temp.name)/'planning.sqlite3';self.tests=Path(self.temp.name)/'tests.sqlite3'
        server.initialize(self.planning);self.service=DriveTestService(self.planning,self.tests);self.service.worker.close()
        capture,prediction,descriptor,options=fixtures.multisite_inputs();self.spec=dict(capture_id=capture['id'],prediction_id=prediction['id'],descriptor_raw=json.dumps(descriptor),options=options)
        with connection(self.tests) as db:
            for test in (capture,prediction):
                rows=test['rows'];db.execute('INSERT INTO tests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',(test['id'],str(uuid.uuid4()),canonical(test['scope']),test.get('label','Software fixture'),
                    'Not real field data','software-test.csv',test['sha256'],test['kind'],'2026-11-02T00:00:00Z',rows[0]['t'],rows[-1]['t'],len(rows),zlib.compress(canonical(rows).encode())))
                if 'context' in test:db.execute('INSERT INTO test_contexts VALUES (?,?,NULL)',(test['id'],canonical(test['context'])))
        self.httpd=server.ViewerHTTPServer(('127.0.0.1',0),server.handler_for(self.planning));self.httpd.drive_service=self.service
        self.thread=threading.Thread(target=self.httpd.serve_forever,daemon=True);self.thread.start();self.addCleanup(self.cleanup)
    def cleanup(self):
        self.httpd.shutdown();self.service.close();self.httpd.server_close();self.temp.cleanup()
    def request(self,method,path,body=None,headers=None,raw=False):
        with closing(http.client.HTTPConnection('127.0.0.1',self.httpd.server_port,timeout=20)) as client:
            data=body if raw else json.dumps(body) if body is not None else None
            client.request(method,path,data,{'Content-Type':'application/json',**(headers or {})});response=client.getresponse()
            return response.status,json.loads(response.read())
    def test_inputs_check_queue_pages_export_and_cancel(self):
        query=f"capture_id={self.spec['capture_id']}&prediction_id={self.spec['prediction_id']}"
        code,inputs=self.request('GET','/api/dm/field-studies/inputs?'+query)
        self.assertEqual(code,200);self.assertEqual(len(inputs['sites']),4);self.assertFalse(inputs['descriptorTemplate']['configuration']['matched'])
        code,check=self.request('POST','/api/dm/field-studies/check',{k:v for k,v in self.spec.items() if k!='options'})
        self.assertEqual(code,200);self.assertTrue(check['ready']);self.assertFalse(check['independentlyVerified'])
        code,study=self.request('POST','/api/dm/field-studies',dict(request_id='http-submit',spec=self.spec));self.assertEqual(code,200)
        self.assertEqual(self.request('GET','/api/dm/field-studies')[1][0]['id'],study['id'])
        self.service.field_store.run_one()
        code,saved=self.request('GET','/api/dm/field-studies/'+study['id']);self.assertEqual(code,200);self.assertEqual(saved['status'],'completed',saved)
        code,page=self.request('GET',f"/api/dm/field-studies/{study['id']}/records?kind=bins&offset=3&limit=8")
        self.assertEqual(code,200);self.assertEqual(len(page['rows']),8);self.assertEqual(page['offset'],3)
        code,export=self.request('GET',f"/api/dm/field-studies/{study['id']}/export")
        self.assertEqual(code,200);self.assertEqual(len(export['result']['observations']),128)
        self.assertEqual(export['snapshot']['descriptorRaw'],self.spec['descriptor_raw'])
        self.assertEqual(self.request('POST',f"/api/dm/field-studies/{study['id']}/cancel",{})[1]['status'],'completed')
    def test_incompatible_contract_is_reviewable_and_cannot_queue(self):
        descriptor=json.loads(self.spec['descriptor_raw']);descriptor['measurement']['quantity']='nr-ss-rsrp';self.spec['descriptor_raw']=json.dumps(descriptor)
        code,check=self.request('POST','/api/dm/field-studies/check',{k:v for k,v in self.spec.items() if k!='options'})
        self.assertEqual(code,200);self.assertFalse(check['ready']);self.assertIn('metric',check['issueCodes'])
        code,error=self.request('POST','/api/dm/field-studies',dict(request_id='bad',spec=self.spec));self.assertEqual(code,400);self.assertIn('RSRP',error['error'])
        self.assertEqual(self.request('GET','/api/dm/field-studies')[1],[])
    def test_oversized_numeric_inputs_return_validation_errors(self):
        descriptor=json.loads(self.spec['descriptor_raw']);descriptor['instrument']['minimumDbm']=10**400
        check={k:v for k,v in self.spec.items() if k!='options'};check['descriptor_raw']=json.dumps(descriptor)
        code,error=self.request('POST','/api/dm/field-studies/check',check)
        self.assertEqual(code,400);self.assertIn('finite',error['error'])
        spec={**self.spec,'options':{**self.spec['options'],'cutoffT':10**400}}
        code,error=self.request('POST','/api/dm/field-studies',dict(request_id='oversized',spec=spec))
        self.assertEqual(code,400);self.assertIn('finite',error['error'])
        self.assertEqual(self.request('GET','/api/dm/field-studies')[1],[])
    def test_guards_unknown_paths_paging_and_request_limits(self):
        for headers in ({'Host':'malicious.invalid'},{'Origin':'https://malicious.invalid'},{'Sec-Fetch-Site':'cross-site'}):
            self.assertEqual(self.request('POST','/api/dm/field-studies/check',{},headers)[0],403)
        for path in ['/api/dm/field-studies/missing','/api/dm/field-studies/missing/export','/api/dm/field-studies/missing/unknown']:
            self.assertEqual(self.request('GET',path)[0],404)
        self.assertEqual(self.request('GET','/api/dm/field-studies/inputs?capture_id=missing')[0],400)
        self.assertEqual(self.request('GET','/api/dm/field-studies/missing/records?kind=bins&offset=no')[0],400)
        self.assertEqual(self.request('POST','/api/dm/field-studies/check','{' ,raw=True)[0],400)
        self.assertEqual(self.request('POST','/api/dm/field-studies/check',' '*1048577,raw=True)[0],413)
        self.assertEqual(self.request('POST','/api/dm/field-studies/check',{}, {'Content-Type':'text/plain'})[0],415)
        self.assertEqual(self.request('POST','/api/dm/field-studies/unknown',{})[0],404)

if __name__=='__main__':unittest.main()
