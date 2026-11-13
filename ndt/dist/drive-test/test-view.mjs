import {ALERT_COLOR, bands, elapsed, FIX, fmt, inspectorMetrics, KEYS, METRICS, MISSING_COLOR, pct, RAT_COLOR, statistics, utc} from './test-model.mjs';
import {drawCDF, setupCanvas} from './graphics.mjs';

export const $ = id => document.getElementById(id);
export const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));
export const compact = value => fmt(value, 0);
export const unitValue = (value, unit) => Number.isFinite(value) ? `${fmt(value)} ${unit}` : '—';
export const legend = (label, color) => `<span><i class="dot" style="--dot:${color}"></i>${esc(label)}</span>`;
const signed = (value, unit = '') => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${fmt(value)}${unit ? ' ' + unit : ''}` : '—';
const text = (id, value) => { $(id).textContent = value; };

export function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((title, i) =>
    `<th scope="col" class="${i ? 'num' : ''}">${esc(title)}</th>`).join('')}</tr></thead><tbody>${rows.map(row =>
    `<tr>${row.map((value, i) => i ? `<td class="num">${esc(value)}</td>` : `<th scope="row">${esc(value)}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function kpiRows(vm) {
  const {metric, analysis, rat} = vm, definition = METRICS[metric];
  const stats = bands(rat).map(r => analysis.byRat[r].stats[metric]);
  const n = stats.reduce((sum, s) => sum + s.n, 0);
  const failed = stats.reduce((sum, s) => sum + s.failed, 0);
  const result = bands(rat).slice().reverse().map(r => {
    const s = analysis.byRat[r].stats[metric];
    return [`${r} median ${definition.label}`, fmt(s.p50), s.n ? definition.unit : '', `${compact(s.n)} valid observations`, false];
  });
  if (rat !== 'all') {
    const tail = metric === 'latency_ms' ? 'p95' : 'p10';
    result.push([`${rat} ${tail.toUpperCase()} ${definition.label}`, fmt(stats[0][tail]), n ? definition.unit : '',
      `${compact(stats[0].missing)} missing values`, false]);
  }
  result.push(['Outside threshold', pct(n ? 100 * failed / n : NaN), '', `${compact(failed)} of ${compact(n)} valid observations`, failed > 0]);
  result.push(['Recorded GPS distance', fmt(analysis.geo.distance, 2), 'km',
    `${compact(analysis.gps)} GPS fixes · all RATs`, false]);
  return result;
}

export function kpiCards(vm) {
  return kpiRows(vm).map(([name, value, unit, detail, warn]) =>
    `<article class="kpi${warn ? ' warn' : ''}"><span>${esc(name)}</span><strong>${value} ${unit ? `<em>${unit}</em>` : ''}</strong><small>${detail}</small></article>`).join('');
}

export function populateRegistry(vm) {
  text('registry-count', compact(vm.tests.length));
  const search = $('search').value.trim().toLowerCase();
  const visible = vm.tests.filter(run => [run.id, run.label, run.scope.region, run.scope.project, run.scope.task,
    run.scope.region_id, run.scope.project_id, run.scope.task_id, run.kind].join(' ').toLowerCase().includes(search));
  $('test-list').innerHTML = visible.map(run => `<button class="test-button" data-id="${esc(run.id)}" aria-pressed="${run.id === vm.test?.id}">
    <b class="mono">${esc(run.id)}</b>${esc(run.label)}<small>${esc(run.scope.project)} · ${run.kind === 'synthetic' ? 'Demo' : run.kind === 'simulated' ? 'Virtual drive' : 'Imported'}</small>
    </button>`).join('') || '<p>No matching Test IDs.</p>';
}

export function renderHeading(vm) {
  const {test, metric} = vm, {scope} = test;
  text('breadcrumb', `Drive tests  /  ${scope.region}  /  ${scope.project}  /  ${scope.task_id}`);
  text('test-id', test.id);
  text('run-title', test.label);
  text('run-context', `${scope.task} · ${scope.task_id} · ${utc(test.start)}`);
  text('source-badge', test.kind === 'synthetic' ? 'Synthetic demo' : test.kind === 'simulated' ? 'Simulated planning power' : 'Imported CSV');
  $('source-badge').classList.toggle('synthetic', test.kind === 'synthetic');
  $('rat').value = vm.rat;
  $('metric').value = metric;
  $('kpis').innerHTML = kpiCards(vm);
  $('map-legend').innerHTML = [...bands(vm.rat).map(rat => legend(rat, RAT_COLOR[rat])),
    legend('Outside threshold', ALERT_COLOR), legend('Metric missing', MISSING_COLOR), legend('Replay cursor', '#142e46')].join('');
  text('map-caption', `${compact(vm.series.filter(FIX).length)} GPS fixes in the selected view · WGS84`);
  const thresholds = bands(vm.rat).map(r => `${r} ${vm.limits[r]}`).join(' / ');
  text('timeline-label', `${METRICS[metric].label} (${METRICS[metric].unit}) · dashed thresholds ${thresholds}`);
  text('duration', elapsed(test.end - test.start, true));
  $('scrub').max = Math.max(1, test.end - test.start);
  $('scrub').step = 1;
  $('event-kind').value = vm.eventKind;
}

let previousSample,previousMetric;
export function renderCursor(vm, x) {
  const {test, selected: row, series, index, playing, t} = vm;
  text('play', playing ? 'Ⅱ Pause' : '▶ Play');
  $('play').disabled = !series.length || test.start === test.end;
  $('previous').disabled = index <= 0;
  $('next').disabled = index >= series.length - 1;
  text('clock', elapsed(t - test.start, true));
  $('scrub').value = t - test.start;
  $('scrub').disabled = !series.length || test.start === test.end;
  $('scrub').setAttribute('aria-valuetext', elapsed(t - test.start, true));
  $('cursor').hidden = !x || !series.length;
  if (x) $('cursor').style.left = `${x(t)}px`;
  if (previousSample === row&&previousMetric===vm.metric) return;
  previousSample = row;previousMetric=vm.metric;
  text('sample-time', row ? utc(row.t) : vm.series.length ? 'No observation at this replay time' : 'No observations for this technology');
  text('sample-rat', row?.rat || '');
  $('sample-rat').className = `badge ${row?.rat || ''}`;
  $('sample-rat').hidden = !row;
  if (!row) {
    $('sample-details').innerHTML = '';
    return;
  }
  const details = [['Band / PCI', [row.band, row.pci].map(value => value ?? '—').join(' / ')],
    ['Cell ID', row.cell_id || '—'], ['ARFCN', row.arfcn ?? '—'],
    ['Downlink / Uplink', `${unitValue(row.dl_mbps, 'Mbps')} / ${unitValue(row.ul_mbps, 'Mbps')}`],
    ['Latency', unitValue(row.latency_ms, 'ms')],
    ['GPS', FIX(row) ? `${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}` : 'No fix']];
  if(Number.isFinite(row.measured_rx_dbm))details.unshift(['Measurement quality',row.measurement_status||'Not declared']);
  $('sample-details').innerHTML = `<div class="metric-pair">${inspectorMetrics(row,vm.metric).map(key => `<div><span>${METRICS[key].label}</span>
    <strong>${fmt(row[key])}</strong><small>${METRICS[key].unit}</small></div>`).join('')}</div>
    <dl class="dl">${details.map(([label, value]) => `<dt>${label}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`;
}

export const selectedEvents = vm => vm.analysis.events.filter(event =>
  (vm.rat === 'all' || event.row.rat === vm.rat) && (vm.eventKind === 'all' || vm.eventKind === event.kind));
export function renderEvents(vm, count) {
  const events = selectedEvents(vm);
  text('events-count', `${compact(events.length)} in selected view`);
  $('events').innerHTML = events.slice(0, count).map(({kind, label, row, worst, count}, i) => `<li>
    <button class="event" data-event="${i}"><small class="${worst ? 'threshold' : ''}">${esc(kind)} · ${row.rat}</small>
    <time class="mono" datetime="${new Date(row.t).toISOString()}">${elapsed(row.t - vm.test.start, true)}</time>
    <strong>${esc(label)}${worst ? ` · ${fmt(worst[vm.metric])} ${METRICS[vm.metric].unit} · ${compact(count)} obs.` : ''}</strong></button></li>`).join('')
    + (events.length > count ? '<li><button id="more-events" class="link-button">Show more events</button></li>' : '')
    || '<li class="empty">No matching events.</li>';
}

export const distribution = vm => table(['Technology / metric', 'Valid', 'Missing', 'Min', 'P10', 'Median', 'P90', 'P95', 'Max'],
  bands(vm.rat).flatMap(rat => KEYS.map(metric => {
    const {n, missing, min, p10, p50, p90, p95, max} = vm.analysis.byRat[rat].stats[metric];
    return [`${rat} · ${METRICS[metric].label} (${METRICS[metric].unit})`, compact(n), compact(missing),
      ...[min, p10, p50, p90, p95, max].map(value => fmt(value))];
  })));

export function compareTable(vm) {
  if (!vm.baseline) return '';
  const {metric, analysis, baselineAnalysis, rat} = vm;
  const rows = [];
  for (const technology of bands(rat)) {
    const a = analysis.byRat[technology].stats[metric], b = baselineAnalysis.byRat[technology].stats[metric];
    for (const [title, key, unit] of [['Valid observations', 'n', ''], ['P10', 'p10', METRICS[metric].unit],
      ['Median', 'p50', METRICS[metric].unit], ['P95', 'p95', METRICS[metric].unit], ['Outside threshold', 'failPct', '%']]) {
      const format = unit === '%' ? pct : unit ? value => unitValue(value, unit) : compact;
      rows.push([`${technology} · ${title}`, format(a[key]), format(b[key]),
        unit === '' ? signed(a[key] - b[key]) : signed(a[key] - b[key], unit === '%' ? 'pp' : unit === 'dBm' ? 'dB' : unit)]);
    }
  }
  return table(['Selected metric', 'Current', 'Baseline', 'Current − baseline'], rows);
}

function cellTable(vm) {
  const cells = new Map();
  for (const row of vm.series) {
    const id = row.cell_id || (Number.isInteger(row.pci) && Number.isInteger(row.arfcn) ? `ARFCN ${row.arfcn} / PCI ${row.pci}` : '');
    if (!id) continue;
    const key = `${row.rat} · ${id}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(row);
  }
  if (!cells.size) return '<p class="empty">No serving-cell identities are available.</p>';
  const ranked = [...cells].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, 20);
  return table(['Technology / cell', 'Observations', 'Valid', 'P10', 'Median', 'Outside threshold'], ranked.map(([key, rows]) => {
    const stat = statistics(rows, vm.metric, rows[0].rat, vm.limits);
    return [key, compact(rows.length), compact(stat.n), fmt(stat.p10), fmt(stat.p50), pct(stat.failPct)];
  }));
}

export function renderAnalytics(vm) {
  const unit = METRICS[vm.metric].unit;
  const compareOptions = vm.candidates().map(run =>
    `<option value="${esc(run.id)}"${run.id === vm.compareId ? ' selected' : ''}>${esc(run.id)} · ${esc(run.label)}</option>`).join('');
  $('analytics').innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Run comparison</h2><p>${METRICS[vm.metric].label} · same Project and Task</p></div>
    <label class="compare-controls">Baseline Test ID<select id="baseline" ${compareOptions ? '' : 'disabled'}><option value="">Select baseline</option>${compareOptions}</select></label></div>
    <div class="section-body">${vm.comparing ? '<p class="empty" role="status">Loading baseline…</p>' : compareTable(vm)}
    <p class="note">${compareOptions ? 'Both runs use the current profile. Distributions use each run’s available observations; routes and conditions are not aligned.' :
      'Import another run under the same region, Project and Task to compare results.'}</p></div></section>
    <section class="panel"><div class="panel-head"><div><h2>Cumulative distribution</h2><p>${METRICS[vm.metric].label} (${unit}) · share of valid samples at or below each value</p></div></div>
    <div class="cdf-frame"><canvas id="cdf-chart" role="img" aria-label="Empirical cumulative distribution. Exact percentiles and sample counts are in the tables below."></canvas></div>
    <div class="legend">${bands(vm.rat).map(r => legend(r, RAT_COLOR[r])).join('')}<span>Solid: current</span>${vm.baseline ? '<span>Dashed: baseline</span>' : ''}</div></section>
    <section class="panel"><div class="panel-head"><div><h2>KPI distributions</h2><p>Per-technology observation counts and percentiles</p></div></div>
    <div class="section-body">${distribution(vm)}</div></section>
    <section class="panel"><div class="panel-head"><div><h2>Serving-cell breakdown</h2><p>Up to 20 identities ranked by observation count · ${METRICS[vm.metric].label} (${unit})</p></div></div>
    <div class="section-body">${cellTable(vm)}</div></section>`;
  renderCDF(vm);
}

export function renderCDF(vm) {
  const canvas = $('cdf-chart');
  if (!canvas?.clientWidth) return;
  drawCDF(setupCanvas(canvas, canvas.clientWidth, canvas.clientHeight), canvas.clientWidth, canvas.clientHeight, vm);
}
