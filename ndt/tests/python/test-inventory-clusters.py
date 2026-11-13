"""Named inventory groups do not rewrite planning membership or infer connectivity."""
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
import http.client,json,sys,tempfile,threading,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend import server
from backend.task_store import connect
from backend.inventory_clusters import initialize_clusters,read_clusters,save_clusters,ClusterConflict

class InventoryClusters(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'planning.sqlite3';server.initialize(self.path)
        with closing(connect(self.path)) as db,db:
            initialize_clusters(db)
            self.site=db.execute("SELECT site_id FROM network_sites WHERE region_id='toronto' LIMIT 1").fetchone()[0]
            self.fingerprint=db.execute("SELECT fingerprint FROM regions WHERE id='toronto'").fetchone()[0]
        self.body=dict(expectedRevision=0,sourceFingerprint=self.fingerprint,clusters=[dict(id='north',name='North sector review',siteIds=[self.site])])
    def tearDown(self):self.temp.cleanup()
    def save(self,body=None,region='toronto',project='harbourfront'):
        with closing(connect(self.path)) as db,db:return save_clusters(db,region,project,body or self.body)
    def test_durable_named_groups_and_conflict_without_changing_planning_sites(self):
        saved=self.save();self.assertEqual(saved['revision'],1);self.assertEqual(saved['clusters'],self.body['clusters'])
        with self.assertRaises(ClusterConflict):self.save()
        body={**self.body,'expectedRevision':1,'clusters':[dict(id='north',name='Renamed',siteIds=[])]}
        self.assertEqual(self.save(body)['revision'],2);server.initialize(self.path)
        with closing(connect(self.path)) as db:
            self.assertEqual(read_clusters(db,'toronto','harbourfront')['clusters'],body['clusters'])
            self.assertEqual(db.execute('SELECT count(*) FROM project_sites').fetchone()[0],0)
            self.assertEqual(read_clusters(db,'toronto','northyork')['revision'],0)
    def test_validation_and_source_changes_fail_without_overwriting(self):
        self.save()
        for changes in [dict(expectedRevision=True),dict(clusters=[dict(id='bad/id',name='A',siteIds=[])]),dict(clusters=[dict(id='a',name=' ',siteIds=[])]),dict(clusters=[dict(id='a',name='A\nB',siteIds=[])]),dict(clusters=[dict(id='a',name='A',siteIds=['unknown'])]),dict(clusters=[dict(id='a',name='A',siteIds=[self.site,self.site])]),dict(clusters=[dict(id='a',name='A',siteIds=[]),dict(id='b',name='a',siteIds=[])])]:
            with self.subTest(changes=changes),self.assertRaises(ValueError):self.save({**self.body,'expectedRevision':1,**changes})
        with self.assertRaises(LookupError):self.save(region='new-york',project='harbourfront')
        with closing(connect(self.path)) as db,db:db.execute("UPDATE regions SET fingerprint='changed' WHERE id='toronto'")
        with self.assertRaises(ClusterConflict):self.save({**self.body,'expectedRevision':1})
        with closing(connect(self.path)) as db:self.assertEqual(read_clusters(db,'toronto','harbourfront')['revision'],1)
    def test_parallel_writers_and_retained_missing_ids(self):
        self.save()
        def write(name):
            try:return self.save({**self.body,'expectedRevision':1,'clusters':[dict(id='north',name=name,siteIds=[self.site])]})['revision']
            except ClusterConflict:return 'conflict'
        with ThreadPoolExecutor(2) as pool:self.assertCountEqual(list(pool.map(write,['One','Two'])),[2,'conflict'])
        with closing(connect(self.path)) as db,db:db.execute('DELETE FROM network_sites WHERE site_id=? AND region_id=?',(self.site,'toronto'))
        with closing(connect(self.path)) as db:
            saved=read_clusters(db,'toronto','harbourfront');self.assertEqual(saved['clusters'][0]['siteIds'],[self.site]);self.assertEqual(saved['missingSiteIds'],[self.site])
    def test_local_http_scope_validation_and_conflicts(self):
        httpd=server.ViewerHTTPServer(('127.0.0.1',0),server.handler_for(self.path));thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
        path='/api/regions/toronto/projects/harbourfront/inventory-clusters'
        def request(method,body=None,headers=None,url=path):
            conn=http.client.HTTPConnection('127.0.0.1',httpd.server_port);conn.request(method,url,json.dumps(body) if body is not None else None,headers or {});response=conn.getresponse();status=response.status;response.read();conn.close();return status
        try:
            self.assertEqual(request('GET'),200);self.assertEqual(request('PUT',self.body),200);self.assertEqual(request('PUT',self.body),409)
            self.assertEqual(request('PUT',{},headers={'Origin':'https://example.org'}),403)
            self.assertEqual(request('GET',url=path.replace('harbourfront','missing')),404)
        finally:httpd.shutdown();httpd.server_close();thread.join()

if __name__=='__main__':unittest.main()
