"""Durable immutable field jobs, idempotency, cancellation and bounded reads."""
from copy import deepcopy
import importlib.util,json,tempfile,uuid,zlib
from pathlib import Path
import sys,unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.dm.field_store import FieldStudyStore
from backend.dm.dm_model import Conflict,connection,initialize,get_test
from backend.dm.integration import canonical
spec=importlib.util.spec_from_file_location('field_store_inputs',Path(__file__).parents[1]/'fixtures/field-inputs.py')
fixtures=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixtures)

class FieldStore(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'tests.sqlite3';initialize(self.path)
        capture,prediction,descriptor,options=fixtures.multisite_inputs();self.capture=capture;self.prediction=prediction
        self.spec=dict(capture_id=capture['id'],prediction_id=prediction['id'],descriptor_raw=json.dumps(descriptor),options=options)
        with connection(self.path) as db:
            for test in (capture,prediction):
                rows=test['rows'];db.execute('INSERT INTO tests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',(test['id'],str(uuid.uuid4()),canonical(test['scope']),test.get('label','Software fixture'),
                    'Not real field data','software-test.csv',test['sha256'],test['kind'],'2026-11-02T00:00:00Z',rows[0]['t'],rows[-1]['t'],len(rows),zlib.compress(canonical(rows).encode())))
                if 'context' in test:db.execute('INSERT INTO test_contexts VALUES (?,?,NULL)',(test['id'],canonical(test['context'])))
        self.store=FieldStudyStore(self.path)
    def test_retries_are_idempotent_and_changed_inputs_conflict(self):
        first=self.store.submit('request-one',self.spec);again=self.store.submit('request-one',self.spec)
        self.assertEqual(first,again);self.assertEqual(first['status'],'queued');self.assertEqual(len(self.store.list()),1)
        changed=deepcopy(self.spec);changed['options']['timeGapMs']=100
        with self.assertRaises(Conflict):self.store.submit('request-one',changed)
        self.assertNotIn('snapshot',first);self.assertNotIn('descriptor_raw',first['spec'])
    def test_completion_snapshot_paging_and_export_survive_reopen_without_mutating_sources(self):
        before=[get_test(self.path,t['id']) for t in (self.capture,self.prediction)]
        study=self.store.submit('complete',self.spec);self.assertTrue(self.store.run_one());self.assertFalse(self.store.run_one())
        self.store=FieldStudyStore(self.path);result=self.store.get(study['id'])
        self.assertEqual(result['status'],'completed',result['error'])
        self.assertEqual(result['result']['status'],'diagnostic-complete')
        self.assertAlmostEqual(result['result']['calibration']['offsetDb'],3)
        self.assertNotIn('observations',result['result']);self.assertNotIn('bins',result['result']['calibration'])
        page=self.store.records(study['id'],'observations',offset=7,limit=10)
        self.assertEqual(page['total'],128);self.assertEqual(len(page['rows']),10);self.assertEqual(page['rows'][0]['index'],7)
        self.assertEqual(len(self.store.records(study['id'],'bins')['rows']),50)
        exported=self.store.export(study['id'])
        self.assertEqual(len(exported['result']['observations']),128)
        self.assertEqual(exported['snapshot']['descriptorRaw'],self.spec['descriptor_raw'])
        self.assertEqual(before,[get_test(self.path,t['id']) for t in (self.capture,self.prediction)])
        for kind in ['bySite','byCarrier','byEnvironment']:self.assertGreater(self.store.records(study['id'],kind)['total'],0)
    def test_cancelled_queued_or_running_jobs_cannot_publish_late_results(self):
        study=self.store.submit('cancel-queued',self.spec)
        self.assertEqual(self.store.cancel(study['id'])['status'],'cancelled');self.assertFalse(self.store.run_one())
        study=self.store.submit('cancel-running',self.spec)
        from backend.dm.field_study import run_study
        def interrupt(snapshot,**kwargs):
            self.store.cancel(study['id']);return run_study(snapshot)
        with patch('backend.dm.field_store.run_study',side_effect=interrupt):self.store.run_one()
        self.assertEqual(self.store.get(study['id'])['status'],'cancelled')
        self.assertIsNone(self.store.export(study['id'])['result'])
    def test_restart_marks_running_interrupted_and_preserves_queued(self):
        a=self.store.submit('a',self.spec);b=self.store.submit('b',self.spec)
        with connection(self.path) as db:db.execute("UPDATE field_studies SET status='running' WHERE id=?",(a['id'],))
        self.store.recover_interrupted()
        self.assertEqual(self.store.get(a['id'])['status'],'interrupted');self.assertEqual(self.store.get(b['id'])['status'],'queued')
        self.assertTrue(self.store.run_one());self.assertEqual(self.store.get(b['id'])['status'],'completed')
    def test_missing_sources_pagination_and_unavailable_records_fail_clearly(self):
        with self.assertRaises(LookupError):self.store.get('missing')
        bad=deepcopy(self.spec);bad['capture_id']='missing'
        with self.assertRaises(LookupError):self.store.submit('bad',bad)
        study=self.store.submit('paging',self.spec)
        for kwargs in [dict(kind='unknown'),dict(kind='bins',offset=-1),dict(kind='bins',limit=501),dict(kind='bins',limit=True)]:
            with self.assertRaises(ValueError):self.store.records(study['id'],**kwargs)
        self.assertEqual(self.store.records(study['id'],'bins')['total'],0)
    def test_failures_are_persistent_without_partial_records(self):
        study=self.store.submit('failure',self.spec)
        with patch('backend.dm.field_store.run_study',side_effect=ValueError('Frozen replay failed')):self.store.run_one()
        result=self.store.get(study['id']);self.assertEqual(result['status'],'failed');self.assertIn('Frozen replay',result['error'])
        self.assertEqual(self.store.records(study['id'],'observations')['total'],0)
        self.assertIsNone(self.store.export(study['id'])['result'])

    def test_existing_single_owner_worker_runs_field_jobs_without_a_second_owner(self):
        from backend.dm.experiments import ExperimentStore,ExperimentWorker
        import time
        study=self.store.submit('background',self.spec)
        experiments=ExperimentStore(self.path,Path(self.temp.name)/'unused-planning.sqlite3')
        worker=ExperimentWorker(experiments,companion=self.store);self.addCleanup(worker.close)
        second=ExperimentWorker(experiments,companion=self.store);self.addCleanup(second.close)
        self.assertIsNone(second.thread)
        deadline=time.monotonic()+5
        while self.store.get(study['id'])['status'] in ('queued','running') and time.monotonic()<deadline:time.sleep(.03)
        self.assertEqual(self.store.get(study['id'])['status'],'completed')

if __name__=='__main__':unittest.main()
