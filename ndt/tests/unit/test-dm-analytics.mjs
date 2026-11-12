import assert from 'node:assert/strict';
import {test} from 'node:test';
import {drawCDF} from '../../dist/drive-test/graphics.mjs';
import {compareTable} from '../../dist/drive-test/test-view.mjs';
import {acceptance, analysisPackage, analyze, DEFAULT_PROFILE, filterSamples, METRICS, nearestIndex, statistics, traceGeometry} from '../../dist/drive-test/test-model.mjs';

const rows = [
  {t: 0, rat: 'LTE', latitude: 43.6, longitude: -79.4, rsrp_dbm: -112, latency_ms: 10, cell_id: 'a'},
  {t: 0, rat: 'NR', rsrp_dbm: -100, cell_id: 'N'},
  {t: 1000, rat: 'LTE', latitude: 43.6, longitude: -79.399, rsrp_dbm: -116, latency_ms: 61, cell_id: 'b'},
  {t: 2000, rat: 'LTE', rsrp_dbm: -105, latency_ms: 60},
  {t: 2000, rat: 'NR', latitude: 43.6, longitude: -79.398, rsrp_dbm: -118, cell_id: 'N'},
  {t: 3000, rat: 'LTE'},
  {t: 18000, rat: 'LTE', latitude: 43.6, longitude: -79.39, rsrp_dbm: -117, cell_id: 'c'},
];
const config = METRICS.rsrp_dbm.limit;
const output = analyze(rows, 'rsrp_dbm', config, 10);
test('baseline power deltas use dB while absolute measurements retain dBm', () => {
  const current = analyze([{t: 0, rat: 'NR', rsrp_dbm: -97}], 'rsrp_dbm', config, 10);
  const baseline = analyze([{t: 0, rat: 'NR', rsrp_dbm: -100}], 'rsrp_dbm', config, 10);
  const html = compareTable({baseline: {}, metric: 'rsrp_dbm', rat: 'NR', analysis: current, baselineAnalysis: baseline});
  assert.ok(html.includes('-97.0 dBm'));
  assert.ok(html.includes('+3.0 dB</td>'));
  assert.ok(!html.includes('+3.0 dBm'));
});
test('radio statistics, excursions and GPS continuity preserve their measurement basis', () => {
assert.equal(output.gps, 4);
assert.equal(output.geo.segments.length, 2);
assert.ok(output.geo.distance > .15 && output.geo.distance < .17);
assert.equal(traceGeometry(rows.filter(r => r.t !== 3000), 10000).breaks, 1);
assert.equal(output.byRat.LTE.stats.rsrp_dbm.p50, -114);
assert.equal(output.byRat.LTE.stats.rsrp_dbm.missing, 1);
assert.equal(output.byRat.LTE.stats.rsrp_dbm.failPct, 75);
assert.equal(output.events.filter(e => e.kind === 'Observed cell change').length, 1);
assert.deepEqual(output.events.filter(e => e.worst).map(e => [e.row.rat, e.count]), [['LTE', 2], ['NR', 1], ['LTE', 1]]);
assert.equal(statistics(rows, 'latency_ms', 'LTE', METRICS.latency_ms.limit).failed, 1);
assert.equal(nearestIndex(rows, 1001), 2);
assert.equal(nearestIndex([], 1001), -1);
});

test('acceptance blocks missing evidence and includes exact acceptance boundaries', () => {
  const profile = {...DEFAULT_PROFILE, minSamples: 2, minCoveragePct: 100, minGpsPct: 100, maxFailPct: 50};
  const capture = [{t: 0, rat: 'NR', latitude: 1, longitude: 1, rsrp_dbm: -105},
    {t: 1000, rat: 'NR', latitude: 1, longitude: 1, rsrp_dbm: -106}];
  const result = analyze(capture, 'rsrp_dbm', config, 10);
  assert.equal(acceptance(result, 'rsrp_dbm', 'NR', profile)[0].status, 'pass');
  assert.equal(acceptance(result, 'rsrp_dbm', 'NR', {...profile, maxFailPct: 49})[0].status, 'fail');
  assert.equal(acceptance(result, 'rsrp_dbm', 'all', profile)[0].status, 'insufficient');
  assert.equal(acceptance(result, 'rsrp_dbm', 'NR', {...profile, minSamples: 3})[0].status, 'insufficient');
  const missing = analyze([{t: 0, rat: 'NR'}], 'rsrp_dbm', config, 10);
  assert.equal(acceptance(missing, 'rsrp_dbm', 'NR', {...profile, minSamples: 1, minCoveragePct: 0, minGpsPct: 0})[0].status, 'insufficient');
});

test('profile thresholds apply to non-selected distributions and latency direction', () => {
  const thresholds = structuredClone(DEFAULT_PROFILE.thresholds);
  thresholds.latency_ms = {LTE: 9, NR: 100};
  const result = analyze(rows, 'rsrp_dbm', config, 10, thresholds);
  assert.equal(result.byRat.LTE.stats.latency_ms.failed, 3);
  assert.equal(statistics([{latency_ms: 100}], 'latency_ms', 'NR', thresholds.latency_ms).failed, 0);
});

test('sample filters preserve original sample identities and missing values', () => {
  assert.deepEqual(filterSamples(rows, 'rsrp_dbm', config, {status: 'missing'}), [rows[5]]);
  assert.deepEqual(filterSamples(rows, 'rsrp_dbm', config, {status: 'passed', search: 'LTE'}), [rows[3]]);
  assert.deepEqual(filterSamples(rows, 'rsrp_dbm', config, {status: 'failed', search: ' LTE '}), [rows[0], rows[2], rows[6]]);
});

test('analysis export carries immutable observations, profile, comparison and provenance', () => {
  const vm = {test: {id: 'a', sha256: 'source', rows, revision: 2, issues: [], audit: []},
    metric: 'rsrp_dbm', rat: 'LTE', profile: DEFAULT_PROFILE, analysis: output, baseline: {id: 'b', sha256: 'baseline'}, baselineAnalysis: output};
  const exported = JSON.parse(JSON.stringify(analysisPackage(vm)));
  assert.equal(exported.schema, 'drive-test-dm.analysis.v1');
  assert.equal(exported.analysis.revision, 2);
  assert.equal(exported.observations.length, rows.length);
  assert.equal(exported.baseline.sha256, 'baseline');
  assert.deepEqual(Object.keys(exported.baseline.distributions), ['LTE']);
  assert.ok(exported.analysis.events.every(e => e.row.rat === 'LTE'));
});

test('empirical CDF groups equal values into a single probability step', () => {
  const paths = [];
  const ctx = {setLineDash() {}, fillText() {}, beginPath() { paths.push([]); },
    moveTo(x, y) { paths.at(-1).push([x, y]); }, lineTo(x, y) { paths.at(-1).push([x, y]); }, stroke() {}};
  const series = [{rsrp_dbm: -110}, {rsrp_dbm: -110}, {rsrp_dbm: -90}, {}];
  drawCDF(ctx, 400, 230, {rat: 'NR', metric: 'rsrp_dbm', analysis: {byRat: {NR: {series}}}});
  const cdf = paths.at(-1);
  assert.deepEqual(cdf, [[48, 198], [48, 198], [48, 78], [378, 78], [378, 18], [378, 18]]);
});
