"""Source-backed equipment graph import, validation and immutable retention."""
from contextlib import closing
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import threading
import http.client
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend import server
from backend.task_store import connect
from backend.equipment_inventory import validate_inventory, trace_cell, import_inventory, read_inventory, InventoryConflict

EXAMPLE=json.loads((Path(__file__).parents[1]/'fixtures/equipment-example.json').read_text())

class EquipmentInventory(unittest.TestCase):
    def sample(self):
        return copy.deepcopy(EXAMPLE)

    def test_trace_retains_source_evidence_and_separates_zero_from_unknown(self):
        data=self.sample();data['antennas'][0]['gainDbi']=0
        validate_inventory(data,{'TEST-SITE'})
        trace=trace_cell(data,'cell-1')
        self.assertEqual(trace['site']['id'],'site-1')
        self.assertEqual(trace['radio']['id'],'radio-1')
        self.assertEqual(trace['connections'][0]['antenna']['gainDbi'],0)
        self.assertEqual(trace['connections'][0]['link']['sourceRecordId'],'link-row-1')
        data['antennas'][0]['gainDbi']=None
        self.assertIsNone(trace_cell(data,'cell-1')['connections'][0]['antenna']['gainDbi'])

    def test_duplicates_broken_links_cross_site_links_and_missing_provenance_fail(self):
        mutations=[
            lambda d:d['cells'].append(copy.deepcopy(d['cells'][0])),
            lambda d:d['cells'][0].update(radioId='missing-radio'),
            lambda d:d['links'][0].update(antennaPortId='missing-port'),
            lambda d:d['antennas'][0].update(siteId='missing-site'),
            lambda d:d['cells'][0].update(sourceId='missing-source'),
            lambda d:d['cells'][0].update(sourceRecordId=''),
            lambda d:d['sources'][0].update(observedAt='yesterday'),
            lambda d:d['sites'][0].update(inventorySiteId='invented-site'),
            lambda d:d['sites'][0].update(inventorySiteId=[]),
            lambda d:d['radios'][0].update(powerDbm=10**400),
            lambda d:d['patterns'][0].update(horizontal=[[-180,30],[180,0]])]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                data=self.sample();mutate(data)
                with self.assertRaises(ValueError):validate_inventory(data,{'TEST-SITE'})
        data=self.sample();data['sites'].append({**data['sites'][0],'id':'site-2'});data['radios'][0]['siteId']='site-2'
        with self.assertRaisesRegex(ValueError,'same site'):validate_inventory(data,{'TEST-SITE'})

    def test_missing_connections_are_unknown_not_invented(self):
        data=self.sample();data['links']=[];data['cells'][0]['radioId']=None
        validate_inventory(data,{'TEST-SITE'})
        trace=trace_cell(data,'cell-1')
        self.assertIsNone(trace['radio']);self.assertEqual(trace['connections'],[])
        for field in ['frequencyMHz','bandwidthMHz']:
            data['cells'][0][field]=None
        validate_inventory(data,{'TEST-SITE'})

    def test_import_is_durable_atomic_scoped_and_preserves_raw_source_hash(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'planning.sqlite3';server.initialize(path)
            with closing(connect(path)) as db:
                site=db.execute("SELECT site_id FROM network_sites WHERE region_id='toronto' LIMIT 1").fetchone()[0]
            data=self.sample();data['sites'][0]['inventorySiteId']=site
            raw=b'\xef\xbb\xbf'+json.dumps(data).encode()
            with closing(connect(path)) as db,db:
                saved=import_inventory(db,'toronto','harbourfront',raw,0)
                self.assertEqual(saved['sha256'],hashlib.sha256(raw).hexdigest())
                self.assertEqual(saved['revision'],1)
            with closing(connect(path)) as db,db:
                with self.assertRaises(InventoryConflict):import_inventory(db,'toronto','harbourfront',raw,0)
            data['links'][0]['cellId']='broken'
            with closing(connect(path)) as db,db:
                with self.assertRaises(ValueError):import_inventory(db,'toronto','harbourfront',json.dumps(data).encode(),1)
            server.initialize(path)
            with closing(connect(path)) as db:
                read=read_inventory(db,'toronto','harbourfront')
                self.assertEqual(read['revision'],1);self.assertEqual(read['data']['cells'][0]['id'],'cell-1')
                self.assertEqual(read['raw'],raw.decode())
                self.assertIsNone(read_inventory(db,'toronto','northyork'))

    def test_http_preview_commit_conflicts_and_source_change_gate(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'planning.sqlite3';server.initialize(path)
            with closing(connect(path)) as db:
                site=db.execute("SELECT site_id FROM network_sites WHERE region_id='toronto' LIMIT 1").fetchone()[0]
            data=self.sample();data['sites'][0]['inventorySiteId']=site;raw=json.dumps(data)
            httpd=server.ViewerHTTPServer(('127.0.0.1',0),server.handler_for(path))
            threading.Thread(target=httpd.serve_forever,daemon=True).start()
            url='/api/regions/toronto/projects/harbourfront/equipment-inventory'
            def request(method,body=None,headers=None,suffix=''):
                with closing(http.client.HTTPConnection('127.0.0.1',httpd.server_port,timeout=10)) as client:
                    client.request(method,url+suffix,json.dumps(body) if body is not None else None,{'Content-Type':'application/json',**(headers or {})})
                    response=client.getresponse();content=response.read()
                    return response.status,json.loads(content) if content.startswith((b'{',b'[',b'null')) else content.decode()
            try:
                self.assertEqual(request('GET'),(200,None))
                status,preview=request('POST',dict(raw=raw));self.assertEqual(status,200)
                self.assertEqual(preview['counts']['cells'],1)
                self.assertEqual(request('GET'),(200,None),'preview must not save')
                body=dict(raw=raw,expectedRevision=0,sourceFingerprint=preview['sourceFingerprint'])
                self.assertEqual(request('PUT',body)[0],200)
                self.assertEqual(request('PUT',body)[0],409)
                self.assertEqual(request('GET',suffix='?revision=1')[1]['raw'],raw)
                self.assertEqual(request('GET',suffix='?revision=2')[0],404)
                self.assertEqual(request('GET',suffix='?revision=999')[0],400)
                self.assertEqual(request('PUT',body,{'Origin':'https://malicious.invalid'})[0],403)
                with closing(connect(path)) as db,db:db.execute("UPDATE regions SET fingerprint='changed' WHERE id='toronto'")
                self.assertEqual(request('PUT',{**body,'expectedRevision':1})[0],409)
                self.assertEqual(request('POST',{'raw':'{}'})[0],400)
            finally:httpd.shutdown();httpd.server_close()

if __name__=='__main__':unittest.main()
