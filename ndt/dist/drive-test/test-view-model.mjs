import {analyze, DEFAULT_PROFILE, GAP_SECONDS, METRICS, nearestIndex} from './test-model.mjs';

const scopeKey = scope => [scope.region_id, scope.project_id, scope.task_id].join('/');
const readProfile=profile=>{const copy=structuredClone(profile);copy.thresholds.measured_rx_dbm??=structuredClone(DEFAULT_PROFILE.thresholds.measured_rx_dbm);return copy;};

export class Workspace {
  constructor(api, clock, scope = {}) {
    this.api = api;
    this.clock = clock;
    this.scope = scope;
  }

  inScope(run) {
    return ['region_id','project_id','task_id'].every(key => !this.scope[key] || run.scope[key] === this.scope[key]);
  }

  tests = [];
  catalog = {};
  test = null;
  baseline = null;
  metric = 'rsrp_dbm';
  rat = 'all';
  limits = {...METRICS.rsrp_dbm.limit};
  gap = GAP_SECONDS;
  speed = 1;
  t = 0;
  index = -1;
  playing = false;
  loading = false;
  comparing = false;
  error = '';
  eventKind = 'all';
  tab = 'replay';
  revision = 0;
  compareRevision = 0;
  profile = structuredClone(DEFAULT_PROFILE);
  saving = false;
  listeners = new Set();

  listen(callback) { this.listeners.add(callback); }
  emit(change = 'full') { for (const callback of this.listeners) callback(change); }

  async start(testId) {
    try {
      [this.tests, this.catalog] = await Promise.all([this.api.loadTests(), this.api.loadCatalog().catch(() =>
        ({tasks: [], regions: [], message: 'Planning catalog unavailable. Enter IDs manually.'}))]);
      this.tests = this.tests.filter(run => this.inScope(run));
      const found = this.tests.find(run => run.id === testId);
      if(!found&&!this.tests.length){this.stop();this.test=null;this.emit();}
      await this.open(found?.id || this.tests[0]?.id);
      if (testId && !found) {
        this.error = 'That Test ID is unavailable.';
        this.emit('busy');
      }
    } catch (error) {
      this.error = error.message;
      this.emit();
    }
  }

  async open(id) {
    if (!id) return this.emit();
    const revision = ++this.revision;
    ++this.compareRevision;
    this.stop();
    this.loading = true;
    this.comparing = false;
    this.error = '';
    this.emit('busy');
    try {
      const test = await this.api.loadTest(id);
      if (revision !== this.revision) return;
      this.test = test;
      this.profile = readProfile(test.profile);
      const measured=test.rows.some(r=>Number.isFinite(r.measured_rx_dbm)),rsrp=test.rows.some(r=>Number.isFinite(r.rsrp_dbm));
      if(test.kind==='simulated')this.metric='predicted_rx_dbm';
      else if(this.metric==='predicted_rx_dbm'||this.metric==='measured_rx_dbm'&&!measured)this.metric=measured&&!rsrp?'measured_rx_dbm':'rsrp_dbm';
      else if(this.metric==='rsrp_dbm'&&!rsrp&&measured)this.metric='measured_rx_dbm';
      this.limits = this.profile.thresholds[this.metric];
      this.gap = this.profile.gap;
      this.baseline = null;
      this.baselineAnalysis = null;
      this.compareId = '';
      this.rat = test.kind === 'simulated' ? test.rows[0].rat : 'all';
      this.eventKind = 'all';
      this.t = test.start;
      this.recalculate();
      this.emit('test');
    } catch (error) {
      if (revision === this.revision) this.error = error.message;
    } finally {
      if (revision === this.revision) {
        this.loading = false;
        this.emit('busy');
      }
    }
  }

  candidates() {
    return this.test ? this.tests.filter(run => run.id !== this.test.id && run.kind === this.test.kind &&
      scopeKey(run.scope) === scopeKey(this.test.scope)) : [];
  }

  async compare(id) {
    if (this.loading || (id && !this.candidates().some(run => run.id === id))) return;
    const revision = ++this.compareRevision;
    this.compareId = id;
    this.routeComparison = null;
    this.baseline = null;
    this.baselineAnalysis = null;
    this.comparing = Boolean(id);
    this.error = '';
    this.emit('comparison');
    if (!id) return;
    try {
      const baseline = await this.api.loadTest(id);
      if (revision !== this.compareRevision) return;
      this.baseline = baseline;
      this.baselineAnalysis = analyze(baseline.rows, this.metric, this.limits, this.gap, this.profile.thresholds);
    } catch (error) {
      if (revision === this.compareRevision) this.error = error.message;
    } finally {
      if (revision === this.compareRevision) {
        this.comparing = false;
        this.emit('comparison');
      }
    }
  }

  recalculate() {
    if (!this.test) return;
    this.analysis = analyze(this.test.rows, this.metric, this.limits, this.gap, this.profile.thresholds);
    this.baselineAnalysis = this.baseline ? analyze(this.baseline.rows, this.metric, this.limits, this.gap, this.profile.thresholds) : null;
    this.series = this.rat === 'all' ? this.test.rows : this.analysis.byRat[this.rat].series;
    this.index = nearestIndex(this.series, this.t);
    this.selected = this.series[this.index];
  }

  setAnalysis({metric = this.metric, rat = this.rat, limits = this.profile.thresholds[metric], gap = this.profile.gap}) {
    this.stop();
    if(metric!==this.metric||rat!==this.rat)this.routeComparison=null;
    this.metric = metric;
    this.rat = rat;
    this.limits = limits;
    this.gap = gap;
    this.recalculate();
    this.emit('analysis');
  }

  async persist(operation) {
    if (!this.test || this.loading || this.saving) throw new Error('Wait for the current operation to finish.');
    const id = this.test.id;
    this.saving = true;
    this.stop();
    this.emit('busy');
    try {
      const state = await operation(id);
      if (this.test?.id === id) {
        Object.assign(this.test, state);
        this.profile = readProfile(state.profile);
        this.limits = this.profile.thresholds[this.metric];
        this.gap = this.profile.gap;
        this.recalculate();
        this.emit('analysis');
      }
    } finally {
      this.saving = false;
      this.emit('busy');
    }
  }

  saveProfile(profile) {
    const revision = this.test.revision;
    return this.persist(id => this.api.saveProfile(id, revision, profile));
  }

  saveIssue(issue) { return this.persist(id => this.api.saveIssue(id, issue)); }
  setIssueStatus(issueId, status) { return this.persist(id => this.api.setIssueStatus(id, issueId, status)); }

  seek(t, exact, replay = false) {
    if (!this.test || !this.series.length || !Number.isFinite(t)) return;
    this.t = Math.round(Math.min(this.test.end, Math.max(this.test.start, t)));
    let target = Number.isInteger(exact) ? exact : nearestIndex(this.series, this.t);
    if (replay && this.series[target]?.t > this.t) target--;
    this.index = target;
    const row = this.series[target];
    this.selected = replay && this.t - row?.t > this.gap * 1000 ? undefined : row;
    this.emit('cursor');
  }

  step(delta) {
    this.stop();
    const index = Math.min(this.series.length - 1, Math.max(0, this.index + delta));
    if (this.series[index]) this.seek(this.series[index].t, index);
  }

  stop() {
    this.playing = false;
    this.clock.cancel(this.frame);
  }

  toggle() {
    if (this.playing) {
      this.stop();
      return this.emit('cursor');
    }
    if (!this.series.length || this.test.end === this.test.start) return;
    if (this.t >= this.test.end) this.seek(this.test.start);
    let last = this.clock.now(), position = this.t;
    const tick = now => {
      if (!this.playing) return;
      position += (now - last) * this.speed;
      this.seek(position, undefined, true);
      last = now;
      if (this.t >= this.test.end) {
        this.stop();
        this.emit('cursor');
      } else this.frame = this.clock.request(tick);
    };
    this.playing = true;
    this.frame = this.clock.request(tick);
    this.emit('cursor');
  }

  jump(row) {
    let index = nearestIndex(this.series, row.t);
    if (this.series[index] !== row && this.series[index + 1] === row) index++;
    this.stop();
    this.seek(row.t, index);
  }

  async importFile(file, details, requestId) {
    const saved = await this.api.saveTest(file, details, requestId);
    this.tests = [saved, ...this.tests.filter(test => test.id !== saved.id)];
    await this.open(saved.id);
    return saved;
  }
}
