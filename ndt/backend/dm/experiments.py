"""Persistent execution inputs, bounded local jobs and reproducible comparisons."""
from copy import deepcopy
from datetime import datetime, timezone
import os
if os.name == 'nt':
    import msvcrt
else:
    import fcntl
import json
import math
import statistics
import threading
import uuid
import zlib

from .dm_model import Conflict, DEFAULT_PROFILE, LIMITS, MAX_ROWS, connection, get_test, initialize
from .integration import canonical, digest, freeze_context, match_route, route_lengths
from .simulation import MODEL, simulate


def now():
    return datetime.now(timezone.utc).isoformat()


def valid_number(value, low, high):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high


class ExperimentStore:
    def __init__(self, path, planning_db):
        self.path, self.planning_db = path, planning_db
        initialize(path)
        with connection(path) as db:
            db.execute('''CREATE TABLE IF NOT EXISTS execution_snapshots(id TEXT PRIMARY KEY,payload TEXT NOT NULL)''')
            db.execute('''CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,
                spec TEXT NOT NULL,snapshot_id TEXT NOT NULL REFERENCES execution_snapshots(id),status TEXT NOT NULL,
                created TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0,result TEXT,error TEXT NOT NULL DEFAULT '')''')
            db.execute('''CREATE TABLE IF NOT EXISTS comparisons(id TEXT PRIMARY KEY,payload TEXT NOT NULL)''')

    def recover_interrupted(self):
        with connection(self.path) as db:
            db.execute("UPDATE experiments SET status='interrupted',error='Server stopped during execution; start a new experiment.' WHERE status='running'")

    def list(self):
        with connection(self.path) as db:
            rows = db.execute('SELECT id,status,created,progress,error,spec FROM experiments ORDER BY created DESC').fetchall()
        return [{**dict(r), 'spec': json.loads(r['spec'])} for r in rows]

    def get(self, identity):
        with connection(self.path) as db:
            row = db.execute('''SELECT e.*,s.payload FROM experiments e JOIN execution_snapshots s ON s.id=e.snapshot_id WHERE e.id=?''', (identity,)).fetchone()
        if row is None:
            raise LookupError('Experiment not found.')
        return {k: row[k] for k in ('id', 'status', 'created', 'progress', 'error')} | dict(spec=json.loads(row['spec']),
            snapshot=json.loads(row['payload']), **(json.loads(row['result']) if row['result'] else dict(runs=[], comparisons=[])))

    def submit(self, request_id, spec):
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128 or not isinstance(spec, dict):
            raise ValueError('Provide an idempotent request ID and experiment specification.')
        allowed = {'region_id','project_id','task_id','route_id','context_hash','case_ids','interval_s','rat','mode',
                   'power_a_dbm','power_b_dbm','transmitter_id','experiment_type'}
        if set(spec) != allowed or spec['experiment_type'] not in ('parameter-ab', 'virtual-drive'):
            raise ValueError('Use the supported power A/B or virtual-drive parameters.')
        if not all(valid_number(spec[k], 0, 90) for k in ('power_a_dbm', 'power_b_dbm')) or not valid_number(spec['interval_s'], .1, 10):
            raise ValueError('EIRP must be 0–90 dBm; the sampling interval must be 0.1–10 s.')
        if spec['rat'] not in ('LTE', 'NR') or spec['mode'] not in ('LOS', 'NLOS'):
            raise ValueError('Choose LTE/NR and LOS/NLOS.')
        with connection(self.path) as db:
            previous = db.execute('SELECT id,spec FROM experiments WHERE request_id=?', (request_id,)).fetchone()
        encoded = canonical(spec)
        if previous:
            if previous['spec'] != encoded:
                raise Conflict('This submission already identifies different experiment inputs.')
            return self.get(previous['id'])
        snapshot = freeze_context(self.planning_db, spec)
        case_ids = spec['case_ids']
        if not isinstance(case_ids, list) or not case_ids or not all(isinstance(c, str) for c in case_ids) or len(set(case_ids)) != len(case_ids) or not set(case_ids) <= {c['id'] for c in snapshot['speedCases']}:
            raise ValueError('Choose one or more saved speed cases.')
        if not snapshot['transmitters'] or spec['transmitter_id'] not in {t['id'] for t in snapshot['transmitters']}:
            raise ValueError('Select a supported planning transmitter. This region/project may lack usable radio data.')
        length = route_lengths(snapshot['route']['coordinates'])[-1]
        counts = [math.ceil(length/(c['speedKmh']/3.6)/spec['interval_s'])+1 for c in snapshot['speedCases'] if c['id'] in case_ids]
        variants = 2 if spec['experiment_type'] == 'parameter-ab' else 1
        if max(counts) > MAX_ROWS or sum(counts)*variants > 200000:
            raise ValueError('Experiment exceeds 100,000 observations per run or 200,000 total. Increase the sampling interval or select fewer cases.')
        identity = 'EXP-'+uuid.uuid4().hex[:20]
        # Freeze a time origin once, outside the client specification used for idempotency.
        snapshot = deepcopy(snapshot)
        snapshot['time_origin'] = round(datetime.now(timezone.utc).timestamp()*1000)
        snapshot['id'] = 'SNAP-'+digest(snapshot)[:24]
        with connection(self.path) as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT id,spec FROM experiments WHERE request_id=?', (request_id,)).fetchone()
            if previous:
                if previous['spec'] != encoded:
                    raise Conflict('This submission already identifies different experiment inputs.')
                identity = previous['id']
            else:
                if db.execute("SELECT count(*) FROM experiments WHERE status IN ('queued','running')").fetchone()[0] >= 20:
                    raise ValueError('The local experiment queue is full. Wait for a job to finish.')
                db.execute('INSERT OR IGNORE INTO execution_snapshots VALUES (?,?)', (snapshot['id'], canonical(snapshot)))
                db.execute('INSERT INTO experiments(id,request_id,spec,snapshot_id,status,created) VALUES (?,?,?,?,?,?)',
                           (identity, request_id, encoded, snapshot['id'], 'queued', now()))
        return self.get(identity)

    def cancel(self, identity):
        with connection(self.path) as db:
            db.execute("UPDATE experiments SET status='cancelled' WHERE id=? AND status IN ('queued','running')", (identity,))
        return self.get(identity)

    def associate(self, test_id, selection):
        test = get_test(self.path, test_id)
        if test is None:
            raise LookupError('Test ID not found.')
        if test['kind'] == 'simulated':
            raise ValueError('A simulated run already has an immutable route context.')
        if any(test['scope'][k] != selection.get(k) for k in ('region_id', 'project_id', 'task_id')):
            raise ValueError('Choose a route from this capture\'s region, Project and Task.')
        snapshot = freeze_context(self.planning_db, selection)
        association = match_route(test['rows'], snapshot['route'], direction=selection.get('direction', 'forward'))
        association['id'] = 'ASSOC-'+digest(dict(test_id=test_id,snapshot=snapshot,association=association))[:24]
        with connection(self.path) as db:
            db.execute('INSERT OR IGNORE INTO route_associations VALUES (?,?,?,?,?)',
                       (association['id'],test_id,canonical(snapshot),canonical(association),now()))
            db.execute('INSERT INTO test_contexts VALUES (?,?,?) ON CONFLICT(test_id) DO UPDATE SET snapshot=excluded.snapshot,association=excluded.association',
                       (test_id, canonical(snapshot), canonical(association)))
        return get_test(self.path, test_id)

    def run_one(self):
        with connection(self.path) as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT id FROM experiments WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if row is None:
                return False
            identity = row['id']
            db.execute("UPDATE experiments SET status='running' WHERE id=?", (identity,))
        try:
            experiment = self.get(identity)
            spec, snapshot = experiment['spec'], experiment['snapshot']
            runs, comparisons = [], []
            for case in (c for c in snapshot['speedCases'] if c['id'] in spec['case_ids']):
                pair = []
                variants = ('A', 'B') if spec['experiment_type'] == 'parameter-ab' else ('A',)
                for variant in variants:
                    powers = {t['id']: spec['power_a_dbm'] for t in snapshot['transmitters']}
                    if variant == 'B':
                        powers[spec['transmitter_id']] = spec['power_b_dbm']
                    manifest = dict(**snapshot, model=MODEL, case=case, powers=powers, mode=spec['mode'], interval_s=spec['interval_s'], rat=spec['rat'],
                                    evaluation_profile=deepcopy(DEFAULT_PROFILE), experiment_id=identity, variant=variant)
                    rows = simulate(snapshot, case, powers, interval_s=spec['interval_s'], rat=spec['rat'], mode=spec['mode'], time_origin=snapshot['time_origin'],
                                    cancelled=lambda: not self.is_running(identity))
                    test_id = 'VDT-'+uuid.uuid4().hex[:20]
                    packed = zlib.compress(canonical(rows).encode())
                    with connection(self.path) as db:
                        db.execute('BEGIN IMMEDIATE')
                        if db.execute('SELECT status FROM experiments WHERE id=?', (identity,)).fetchone()[0] != 'running':
                            raise InterruptedError('Experiment cancelled.')
                        if not rows or len(rows) > MAX_ROWS or any(not valid_number(r['predicted_rx_dbm'], *LIMITS['predicted_rx_dbm']) for r in rows if 'predicted_rx_dbm' in r):
                            raise ValueError('Generated observations failed validation.')
                        db.execute('INSERT INTO tests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', (test_id, f'{identity}:{case["id"]}:{variant}', canonical(snapshot['scope']),
                            f'{snapshot["scope"]["task"]} / {snapshot["route"]["name"]} · {case["speedKmh"]} km/h · {variant}', 'Uncalibrated isotropic planning power; no RSRP, interference, mobility or service model.',
                            'execution-manifest.json', digest(dict(manifest=manifest, rows=rows)), 'simulated', now(), rows[0]['t'], rows[-1]['t'], len(rows), packed))
                        db.execute('INSERT INTO test_contexts VALUES (?,?,NULL)', (test_id, canonical(manifest)))
                        runs.append(dict(test_id=test_id, case_id=case['id'], speed_kmh=case['speedKmh'], variant=variant))
                        db.execute('UPDATE experiments SET progress=?,result=? WHERE id=?', (len(runs), canonical(dict(runs=runs, comparisons=comparisons)), identity))
                    pair.append(test_id)
                if len(pair) == 2:
                    comparisons.append(self.compare(pair[0], pair[1], 'predicted_rx_dbm', DEFAULT_PROFILE))
            with connection(self.path) as db:
                db.execute("UPDATE experiments SET status='completed',result=? WHERE id=? AND status='running'", (canonical(dict(runs=runs, comparisons=comparisons)), identity))
        except InterruptedError:
            self.cancel(identity)
        except Exception as error:
            with connection(self.path) as db:
                db.execute("UPDATE experiments SET status='failed',error=? WHERE id=? AND status='running'", (str(error), identity))
        return True

    def is_running(self, identity):
        with connection(self.path) as db:
            return db.execute('SELECT status FROM experiments WHERE id=?', (identity,)).fetchone()[0] == 'running'

    def compare(self, a_id, b_id, metric, profile, *, bin_m=20, minimum_coverage_pct=80, rat='all'):
        a, b = (get_test(self.path, key) for key in (a_id, b_id))
        if not a or not b:
            raise LookupError('Both comparison Test IDs must exist.')
        if rat not in ('all','LTE','NR'):
            raise ValueError('Choose all, LTE or NR for the comparison.')
        if metric not in DEFAULT_PROFILE['thresholds'] or not a['context'] or not b['context']:
            raise ValueError('Associate both captures with a Task route before route comparison.')
        if a['context']['geometry_hash'] != b['context']['geometry_hash'] or any(a['scope'][k] != b['scope'][k] for k in ('region_id','project_id','task_id')):
            raise ValueError('Comparison needs the same route geometry and Task context.')
        controlled = a['kind'] == b['kind'] == 'simulated'
        if a['kind'] != b['kind']:
            raise ValueError('Use matching data origins and metric definitions. Cross-origin calibration is not supported by the planning-power model.')
        if controlled:
            for key in ('id', 'model', 'case', 'mode', 'interval_s', 'rat'):
                if a['context'][key] != b['context'][key]:
                    raise ValueError('Controlled A/B requires identical route, speed, sampling and model inputs.')
            am = [{'index': i, 'chainage_m': r['chainage_m'], 'status': 'matched'} for i, r in enumerate(a['rows'])]
            bm = [{'index': i, 'chainage_m': r['chainage_m'], 'status': 'matched'} for i, r in enumerate(b['rows'])]
        else:
            if not a['association'] or not b['association'] or a['association']['direction'] != b['association']['direction']:
                raise ValueError('Associate both captures in the same route direction.')
            am, bm = a['association']['samples'], b['association']['samples']
        def bins(test, matches):
            groups = {}
            for match in matches:
                row = test['rows'][match['index']]
                if match['status'] == 'matched' and metric in row and (rat=='all' or row['rat']==rat):
                    key = (math.floor(match['chainage_m']/bin_m), row['rat'])
                    groups.setdefault(key, []).append(row)
            return groups
        left, right = bins(a, am), bins(b, bm)
        common = sorted(left.keys() & right.keys())
        length = route_lengths(a['context']['route']['coordinates'])[-1]
        total_bins = max(1, math.ceil(length/bin_m))
        technologies = ({row['rat'] for test in (a,b) for row in test['rows'] if metric in row} if rat=='all' else {rat})
        coverage_by_rat = {rat:min(100,100*len({k[0] for k in common if k[1]==rat})/total_bins) for rat in technologies}
        coverage = min(coverage_by_rat.values(),default=0)
        if not controlled:
            coverage = min(coverage,a['association']['route_coverage_pct'],b['association']['route_coverage_pct'])
        if not common or coverage < minimum_coverage_pct:
            raise ValueError(f'Insufficient common route coverage: {coverage:.1f}%; need {minimum_coverage_pct}%. Captures remain available for descriptive analysis.')
        def mean(rows):
            values = [r[metric] for r in rows]
            return 10*math.log10(sum(10**(v/10) for v in values)/len(values)) if metric in ('rsrp_dbm', 'predicted_rx_dbm') else statistics.mean(values)
        pairs = []
        for key in common:
            av, bv = mean(left[key]), mean(right[key])
            point = right[key][0]
            pairs.append(dict(chainage_m=key[0]*bin_m, rat=key[1], a=av, b=bv, delta=bv-av, longitude=point['longitude'], latitude=point['latitude']))
        result = dict(schema='ndt.comparison.v1', a_id=a_id, b_id=b_id, a_hash=a['sha256'], b_hash=b['sha256'],
            route_hash=a['context']['geometry_hash'], metric=metric, rat=rat, mode='controlled-model-ab' if controlled else 'observational-route-comparison',
            bin_m=bin_m, minimum_coverage_pct=minimum_coverage_pct, common_coverage_pct=coverage,
            coverage_by_rat=coverage_by_rat, alignment_version='route-bins-v1',
            median_delta=statistics.median(p['delta'] for p in pairs),
            delta_unit='Mbps' if metric in ('dl_mbps','ul_mbps') else 'ms' if metric=='latency_ms' else 'dB',
            pairs=pairs, profile=deepcopy(profile),
            a_context=a['context'], b_context=b['context'], a_association=a['association'], b_association=b['association'],
            a_observations=a['rows'], b_observations=b['rows'])
        if result['delta_unit']=='dB':
            result['median_delta_db']=result['median_delta']
        result['id'] = 'CMP-'+digest(result)[:24]
        with connection(self.path) as db:
            db.execute('INSERT OR IGNORE INTO comparisons VALUES (?,?)', (result['id'], canonical(result)))
        return result


class ExperimentWorker:
    def __init__(self, store):
        self.store, self.stopped, self.wake = store, threading.Event(), threading.Event()
        self.lock = store.path.with_name(store.path.name+'.worker.lock').open('a+b')
        try:
            if os.name == 'nt':
                # Windows byte-range locking needs a byte and a consistent offset.
                if self.lock.seek(0, os.SEEK_END) == 0:
                    self.lock.write(b'\0')
                    self.lock.flush()
                self.lock.seek(0)
                msvcrt.locking(self.lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(self.lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError as exc:
            self.lock.close()
            if not isinstance(exc, BlockingIOError) and not (os.name == 'nt' and exc.errno in (13, 11, 36)):
                raise
            self.thread = None
            return
        self.store.recover_interrupted()
        self.thread = threading.Thread(target=self.run, name='ndt-drive-worker', daemon=True)
        self.thread.start()

    def run(self):
        try:
            while not self.stopped.is_set():
                if not self.store.run_one():
                    self.wake.wait(1)
                    self.wake.clear()
        finally:
            if os.name == 'nt':
                self.lock.seek(0)
                msvcrt.locking(self.lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(self.lock,fcntl.LOCK_UN)
            self.lock.close()

    def close(self):
        self.stopped.set()
        self.wake.set()
        if self.thread:
            self.thread.join(timeout=2)
