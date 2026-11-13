"""Persistent field diagnostics; queued source snapshots never modify planning."""
from datetime import datetime,timezone
import json,uuid,zlib
from .dm_model import Conflict,connection,get_test,initialize
from .field_study import prepare_study,run_study
from .field_measurements import descriptor_template,inspect_measurements
from .integration import canonical

KINDS=('observations','bins','bySite','byCarrier','byEnvironment')

def _pack(value):return zlib.compress(canonical(value).encode('utf8'))
def _unpack(value):return json.loads(zlib.decompress(value))

class FieldStudyStore:
    def __init__(self,path):
        self.path=path;initialize(path)
        with connection(path) as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS field_studies(
                id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,spec TEXT NOT NULL,created TEXT NOT NULL,
                status TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',
                snapshot BLOB NOT NULL,result BLOB,summary TEXT);
                CREATE TABLE IF NOT EXISTS field_study_records(
                study_id TEXT NOT NULL REFERENCES field_studies(id),kind TEXT NOT NULL,ordinal INTEGER NOT NULL,payload TEXT NOT NULL,
                PRIMARY KEY(study_id,kind,ordinal));''')

    def sources(self,capture_id,prediction_id):
        if not all(isinstance(v,str) and 1<=len(v)<=100 for v in (capture_id,prediction_id)):raise ValueError('Choose a capture and frozen prediction Test ID')
        capture,prediction=(get_test(self.path,v) for v in (capture_id,prediction_id))
        if not capture or not prediction:raise LookupError('Both capture and prediction Test IDs must exist')
        return capture,prediction

    def inputs(self,capture_id,prediction_id):
        capture,prediction=self.sources(capture_id,prediction_id)
        def brief(test):return {k:test[k] for k in ('id','label','kind','sha256','scope','start','end','count') if k in test}
        transmitters=(prediction.get('context') or {}).get('transmitters',[])
        sites={t['site_id']:dict(id=t['site_id'],label=t.get('label',t['site_id'])) for t in transmitters}
        return dict(capture=brief(capture),prediction=brief(prediction),sites=list(sites.values()),descriptorTemplate=descriptor_template(capture,prediction))

    def inspect(self,capture_id,prediction_id,descriptor_raw):
        return inspect_measurements(*self.sources(capture_id,prediction_id),descriptor_raw)

    def recover_interrupted(self):
        with connection(self.path) as db:
            db.execute("UPDATE field_studies SET status='interrupted',error='Server stopped during execution; start a new study.' WHERE status='running'")

    @staticmethod
    def _brief(row):
        spec=json.loads(row['spec']);descriptor=spec.pop('descriptor_raw');spec['descriptorBytes']=len(descriptor.encode('utf8'))
        return {k:row[k] for k in ('id','created','status','progress','error')} | dict(spec=spec,result=json.loads(row['summary']) if row['summary'] else None)

    def list(self):
        with connection(self.path) as db:rows=db.execute('SELECT id,created,status,progress,error,spec,summary FROM field_studies ORDER BY created DESC,id DESC').fetchall()
        return [self._brief(r) for r in rows]

    def get(self,identity):
        with connection(self.path) as db:row=db.execute('SELECT id,created,status,progress,error,spec,summary FROM field_studies WHERE id=?',(identity,)).fetchone()
        if row is None:raise LookupError('Field study not found')
        return self._brief(row)

    def submit(self,request_id,spec):
        if not isinstance(request_id,str) or not 1<=len(request_id)<=128 or any(ord(c)<32 for c in request_id):raise ValueError('Provide an idempotent field-study request ID')
        if not isinstance(spec,dict) or set(spec)!={'capture_id','prediction_id','descriptor_raw','options'}:raise ValueError('Provide capture_id, prediction_id, descriptor_raw and field-study options')
        encoded=canonical(spec)
        with connection(self.path) as db:previous=db.execute('SELECT id,spec FROM field_studies WHERE request_id=?',(request_id,)).fetchone()
        if previous:
            if previous['spec']!=encoded:raise Conflict('This submission already identifies different field-study inputs')
            return self.get(previous['id'])
        snapshot=prepare_study(*self.sources(spec['capture_id'],spec['prediction_id']),spec['descriptor_raw'],spec['options'])
        packed=_pack(snapshot);identity='FIELD-'+uuid.uuid4().hex[:20]
        with connection(self.path) as db:
            db.execute('BEGIN IMMEDIATE')
            previous=db.execute('SELECT id,spec FROM field_studies WHERE request_id=?',(request_id,)).fetchone()
            if previous:
                if previous['spec']!=encoded:raise Conflict('This submission already identifies different field-study inputs')
                identity=previous['id']
            else:
                if db.execute("SELECT count(*) FROM field_studies WHERE status IN ('queued','running')").fetchone()[0]>=10:raise Conflict('Ten field studies are active; wait for one or cancel a queued study')
                db.execute('INSERT INTO field_studies(id,request_id,spec,created,status,snapshot) VALUES (?,?,?,?,?,?)',
                    (identity,request_id,encoded,datetime.now(timezone.utc).isoformat(),'queued',packed))
        return self.get(identity)

    def cancel(self,identity):
        with connection(self.path) as db:db.execute("UPDATE field_studies SET status='cancelled' WHERE id=? AND status IN ('queued','running')",(identity,))
        return self.get(identity)

    def records(self,identity,kind,*,offset=0,limit=50):
        if kind not in KINDS or type(offset) is not int or offset<0 or type(limit) is not int or not 1<=limit<=500:raise ValueError('Choose a field record type, nonnegative offset and a page size from 1 to 500')
        study=self.get(identity)
        with connection(self.path) as db:
            total=db.execute('SELECT count(*) FROM field_study_records WHERE study_id=? AND kind=?',(identity,kind)).fetchone()[0]
            rows=db.execute('SELECT payload FROM field_study_records WHERE study_id=? AND kind=? ORDER BY ordinal LIMIT ? OFFSET ?',(identity,kind,limit,offset)).fetchall()
        return dict(studyId=identity,status=study['status'],kind=kind,total=total,offset=offset,limit=limit,rows=[json.loads(r['payload']) for r in rows])

    def export(self,identity):
        study=self.get(identity)
        with connection(self.path) as db:row=db.execute('SELECT snapshot,result FROM field_studies WHERE id=?',(identity,)).fetchone()
        return dict(study,snapshot=_unpack(row['snapshot']),result=_unpack(row['result']) if row['result'] else None)

    def is_running(self,identity):
        with connection(self.path) as db:row=db.execute('SELECT status FROM field_studies WHERE id=?',(identity,)).fetchone()
        return row is not None and row['status']=='running'

    def run_one(self):
        with connection(self.path) as db:
            db.execute('BEGIN IMMEDIATE');row=db.execute("SELECT id,snapshot FROM field_studies WHERE status='queued' ORDER BY created,id LIMIT 1").fetchone()
            if row is None:return False
            identity=row['id'];packed=row['snapshot'];db.execute("UPDATE field_studies SET status='running' WHERE id=?",(identity,))
        try:
            def progress(value):
                with connection(self.path) as db:db.execute("UPDATE field_studies SET progress=? WHERE id=? AND status='running'",(value,identity))
            result=run_study(_unpack(packed),cancelled=lambda:not self.is_running(identity),progress=progress)
            groups=dict(observations=result['observations'],**{k:result['calibration'][k] for k in KINDS[1:]})
            summary={k:v for k,v in result.items() if k!='observations'}
            summary['calibration']={k:v for k,v in result['calibration'].items() if k not in KINDS[1:]}
            summary['recordCounts']={k:len(v) for k,v in groups.items()}
            result_packed=_pack(result);encoded_summary=canonical(summary)
            with connection(self.path) as db:
                db.execute('BEGIN IMMEDIATE')
                if db.execute('SELECT status FROM field_studies WHERE id=?',(identity,)).fetchone()[0]!='running':raise InterruptedError('Field study cancelled')
                for kind,records in groups.items():
                    db.executemany('INSERT INTO field_study_records VALUES (?,?,?,?)',((identity,kind,i,canonical(r)) for i,r in enumerate(records)))
                db.execute("UPDATE field_studies SET status='completed',progress=100,result=?,summary=? WHERE id=?",(result_packed,encoded_summary,identity))
        except InterruptedError:self.cancel(identity)
        except Exception as error:
            with connection(self.path) as db:db.execute("UPDATE field_studies SET status='failed',error=? WHERE id=? AND status='running'",(str(error),identity))
        return True
