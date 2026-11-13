export const RATS = ['LTE', 'NR'];
export const bands = rat => rat === 'all' ? RATS : [rat];
export const METRICS = {
  predicted_rx_dbm: {label: 'Predicted received power', unit: 'dBm', limit: {LTE: -100, NR: -100}, bad: 'below'},
  measured_rx_dbm: {label: 'Measured carrier power', unit: 'dBm', limit: {LTE: -100, NR: -100}, bad: 'below'},
  rsrp_dbm: {label: 'RSRP', unit: 'dBm', limit: {LTE: -105, NR: -105}, bad: 'below'},
  rsrq_db: {label: 'RSRQ', unit: 'dB', limit: {LTE: -15, NR: -15}, bad: 'below'},
  sinr_db: {label: 'SINR', unit: 'dB', limit: {LTE: 0, NR: 0}, bad: 'below'},
  dl_mbps: {label: 'Downlink', unit: 'Mbps', limit: {LTE: 20, NR: 50}, bad: 'below'},
  ul_mbps: {label: 'Uplink', unit: 'Mbps', limit: {LTE: 5, NR: 10}, bad: 'below'},
  latency_ms: {label: 'Latency', unit: 'ms', limit: {LTE: 60, NR: 60}, bad: 'above'},
};
export const KEYS = Object.keys(METRICS);
export const GAP_SECONDS = 10;
export const DEFAULT_PROFILE = {name: 'Field acceptance', gap: GAP_SECONDS, minSamples: 30,
  minCoveragePct: 90, minGpsPct: 90, maxFailPct: 5,
  thresholds: Object.fromEntries(KEYS.map(key => [key, {...METRICS[key].limit}]))};
export const RAT_COLOR = {LTE: '#2565b0', NR: '#087e70'};
export const ALERT_COLOR = '#bb5124';
export const MISSING_COLOR = '#75869a';
export const FIX = row => Number.isFinite(row?.latitude) && Number.isFinite(row?.longitude);
export const fmt = (x, digits = 1) => Number.isFinite(x) ? x.toLocaleString('en-CA', {minimumFractionDigits: digits, maximumFractionDigits: digits}) : '—';
export const pct = x => Number.isFinite(x) ? `${fmt(x)}%` : '—';
export const utc = t => new Date(t).toISOString().replace('T', ' ').replace(/(?:\.000)?Z$/, ' UTC');
export function elapsed(ms, fractional = false) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const clock = [Math.floor(minutes / 60), minutes % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
  return fractional && ms % 1000 ? `${clock}.${String(ms % 1000).padStart(3, '0')}` : clock;
}

export function nearestIndex(rows, time) {
  if (!rows.length) return -1;
  let low = 0, high = rows.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (rows[middle].t < time) low = middle + 1;
    else high = middle;
  }
  return low > 0 && time - rows[low - 1].t < rows[low].t - time ? low - 1 : low;
}

export function fails(value, rat, metric, limits) {
  return Number.isFinite(value) && (METRICS[metric].bad === 'below' ? value < limits[rat] : value > limits[rat]);
}

export const metricValue=(row,metric)=>metric==='measured_rx_dbm'&&row.measurement_status!=='valid'?undefined:row[metric];
export function inspectorMetrics(row,selected){
  const keys=[selected,'rsrp_dbm','rsrq_db','sinr_db','measured_rx_dbm','predicted_rx_dbm'];
  return [...new Set(keys)].filter(k=>k===selected||Number.isFinite(row[k])).slice(0,3);
}

export function observationColor(row, metric, limits) {
  if (!Number.isFinite(metricValue(row,metric))) return MISSING_COLOR;
  return fails(metricValue(row,metric), row.rat, metric, limits) ? ALERT_COLOR : RAT_COLOR[row.rat];
}

export function statistics(rows, metric, rat, limits) {
  const values = rows.map(row => metricValue(row,metric)).filter(Number.isFinite).sort((a, b) => a - b);
  const n = values.length;
  if (!n) return {n, missing: rows.length, failed: 0};
  function quantile(q) {
    const position = (n - 1) * q, low = Math.floor(position);
    return values[low] + (values[Math.ceil(position)] - values[low]) * (position - low);
  }
  const failed = values.filter(value => fails(value, rat, metric, limits)).length;
  return {n, missing: rows.length - n, failed, failPct: 100 * failed / n,
    p10: quantile(.1), p50: quantile(.5), p90: quantile(.9), p95: quantile(.95),
    min: values[0], max: values[n - 1]};
}

export function traceGeometry(rows, maxGap) {
  const segments = [];
  let previous, distance = 0, breaks = 0;
  for (let i = 0; i < rows.length;) {
    let row = rows[i++];
    while (rows[i]?.t === row.t) {
      if (!FIX(row) && FIX(rows[i])) row = rows[i];
      i++;
    }
    if (!FIX(row) || (previous && (row.t - previous.t > maxGap || row.leg_id !== previous.leg_id))) {
      if (previous) breaks++;
      previous = null;
    }
    if (!FIX(row)) continue;
    if (!previous) segments.push([row]);
    else {
      segments.at(-1).push(row);
      distance += haversine(previous, row);
    }
    previous = row;
  }
  return {segments, distance, breaks};
}

function haversine(a, b) {
  const radians = Math.PI / 180;
  const dlat = (b.latitude - a.latitude) * radians, dlng = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dlng / 2) ** 2;
  return 12742.0176 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function cellChange(before, after) {
  let a, b;
  if (before.cell_id && after.cell_id) {
    [a, b] = [before.cell_id, after.cell_id];
  } else if ([before, after].every(row => Number.isInteger(row.pci) && Number.isInteger(row.arfcn))) {
    [a, b] = [before, after].map(row => `ARFCN ${row.arfcn} / PCI ${row.pci}`);
  }
  return a !== b ? `${a} → ${b}` : '';
}

export function analyze(rows, metric, limits, gapSeconds, thresholds = {}) {
  const gap = gapSeconds * 1000, geo = traceGeometry(rows, gap);
  const byRat = {};
  const events = rows.filter(row => row.event).map(row => ({kind: 'Logged', label: row.event, row}));
  for (const rat of RATS) {
    const series = rows.filter(row => row.rat === rat);
    const stats = Object.fromEntries(KEYS.map(key => [key, statistics(series, key, rat, key === metric ? limits : thresholds[key] || METRICS[key].limit)]));
    byRat[rat] = {series, stats};
    let previous, episode;
    for (const row of series) {
      const adjacent = previous && row.t - previous.t <= gap;
      const change = adjacent && cellChange(previous, row);
      if (change) events.push({kind: Number.isFinite(row.predicted_rx_dbm) ? 'Predicted selection change' : 'Observed cell change', label: change, row});
      if (fails(metricValue(row,metric), rat, metric, limits)) {
        if (!episode || !adjacent) {
          episode = {kind: 'Threshold excursion', label: `${METRICS[metric].label} ${METRICS[metric].bad} threshold`,
            row, end: row, worst: row, count: 0};
          events.push(episode);
        }
        episode.end = row;
        episode.count++;
        if (METRICS[metric].bad === 'below' ? row[metric] < episode.worst[metric] : row[metric] > episode.worst[metric]) episode.worst = row;
      } else episode = null;
      previous = row;
    }
  }
  events.sort((a, b) => a.row.t - b.row.t || a.kind.localeCompare(b.kind));
  return {byRat, events, geo, gps: rows.filter(FIX).length};
}

export function acceptance(analysis, metric, rat, profile) {
  return bands(rat).map(technology => {
    const {series, stats} = analysis.byRat[technology], stat = stats[metric];
    const coverage = series.length ? 100 * stat.n / series.length : 0;
    const gps = series.length ? 100 * series.filter(FIX).length / series.length : 0;
    const reasons = [];
    if (stat.n < profile.minSamples) reasons.push(`${stat.n} valid; need ${profile.minSamples}`);
    if (coverage < profile.minCoveragePct) reasons.push(`Metric coverage ${fmt(coverage)}%; need ${profile.minCoveragePct}%`);
    if (gps < profile.minGpsPct) reasons.push(`GPS coverage ${fmt(gps)}%; need ${profile.minGpsPct}%`);
    const status = reasons.length ? 'insufficient' : stat.failPct > profile.maxFailPct ? 'fail' : 'pass';
    if (status === 'fail') reasons.push(`${fmt(stat.failPct)}% outside threshold; allowed ${profile.maxFailPct}%`);
    if (status === 'pass') reasons.push(`${fmt(stat.failPct)}% outside threshold; allowed ${profile.maxFailPct}%`);
    return {rat: technology, status, coverage, gps, ...stat, reasons};
  });
}

export function filterSamples(rows, metric, limits, {search = '', status = 'all'} = {}) {
  const query = search.trim().toLowerCase();
  return rows.filter(row => (!query || [utc(row.t), row.rat, row.band, row.cell_id, row.pci, row.arfcn, row.event]
    .join(' ').toLowerCase().includes(query)) && (status === 'all' ||
      (status === 'missing' ? !Number.isFinite(metricValue(row,metric)) :
        status === 'failed' ? fails(metricValue(row,metric), row.rat, metric, limits) : Number.isFinite(metricValue(row,metric)) && !fails(metricValue(row,metric), row.rat, metric, limits))));
}

export function analysisPackage(vm) {
  return {schema: 'drive-test-dm.analysis.v1', exportedAt: new Date().toISOString(),
    run: {...vm.test, rows: undefined, profile: undefined, revision: undefined, issues: undefined, audit: undefined},
    analysis: {metric: vm.metric, rat: vm.rat, profile: vm.profile, revision: vm.test.revision,
      acceptance: acceptance(vm.analysis, vm.metric, vm.rat, vm.profile),
      distributions: Object.fromEntries(bands(vm.rat).map(r => [r, vm.analysis.byRat[r].stats])),
      events: vm.analysis.events.filter(e => vm.rat === 'all' || e.row.rat === vm.rat)},
    baseline: vm.baseline ? {id: vm.baseline.id, sha256: vm.baseline.sha256,
      distributions: Object.fromEntries(bands(vm.rat).map(r => [r, vm.baselineAnalysis.byRat[r].stats]))} : null,
    routeComparison: vm.routeComparison || null,
    issues: vm.test.issues, audit: vm.test.audit, observations: vm.test.rows,
    method: vm.test.kind==='simulated'
      ? 'Uncalibrated planning received power. Source hash covers the execution manifest and observations. A saved routeComparison records its own alignment and frozen evaluation basis.'
      : 'Sample-weighted descriptive distributions. A saved routeComparison records its own spatial alignment and frozen evaluation basis; imported comparisons remain observational. Original file hash refers to the imported bytes.'};
}
