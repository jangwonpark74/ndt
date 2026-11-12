import {acceptance, ALERT_COLOR, bands, elapsed, METRICS, MISSING_COLOR, RAT_COLOR, utc} from './test-model.mjs';
import {drawRoute, drawTimeline, setupCanvas} from './graphics.mjs';
import {$, compact, compareTable, distribution, esc, kpiRows, legend, table, unitValue} from './test-view.mjs';

const footer = (test, page) => `<div class="report-foot"><span>CongitV NDT Drive tests · ${esc(test.id)}${test.kind === 'synthetic' ? ' · Synthetic demonstration' : test.kind==='simulated'?' · Simulated planning power':''}</span><span class="section-number">${page} / ${3+(test.issues?.length?1:0)+(test.context?1:0)}</span></div>`;

const fmtPercent=value=>Number(value).toFixed(1)+'%';

function reportFinding(vm, events) {
  const {metric, test} = vm, def = METRICS[metric];
  const excursions = events.filter(event => event.worst);
  if (!excursions.length) return 'No threshold excursions were detected in the available observations for this view.';
  const worst = excursions.reduce((a, b) =>
    (def.bad === 'below' ? b.worst[metric] < a.worst[metric] : b.worst[metric] > a.worst[metric]) ? b : a);
  const {row, end, worst: sample} = worst;
  return `${compact(excursions.length)} threshold excursion${excursions.length === 1 ? '' : 's'}. The most extreme observation was
    ${row.rat} ${def.label} at ${unitValue(sample[metric], def.unit)}, elapsed ${elapsed(sample.t - test.start, true)}.
    The excursion spanned ${elapsed(row.t - test.start, true)} to ${elapsed(end.t - test.start, true)} across ${compact(worst.count)} observations.`;
}

export function renderReport(vm, snapshot) {
  const {test, metric, analysis, rat} = vm, {scope} = test, def = METRICS[metric];
  const title = esc(test.label), rats = bands(rat);
  const events = analysis.events.filter(event => rats.includes(event.row.rat));
  const counts = [['Logged', 'logged event'], ['Observed cell change', 'observed cell change'],
    ['Threshold excursion', 'threshold excursion']].map(([kind, label]) => {
    const count = events.filter(event => event.kind === kind).length;
    return `${compact(count)} ${label}${count === 1 ? '' : 's'}`;
  });
  const baseline = vm.baseline ? compareTable(vm) : '<p class="note">Select a baseline in KPI analytics to include a run comparison.</p>';
  const rule = rats.map(r => `${r} ${def.bad} ${vm.limits[r]} ${def.unit}`).join(' · ');
  const gpsMissing = test.count - analysis.gps;
  const within = snapshot && vm.series.some(row => Number.isFinite(row.latitude)) &&
    vm.series.every(row => !Number.isFinite(row.latitude) ||
      (row.longitude >= -79.401 && row.longitude <= -79.376 && row.latitude >= 43.6388 && row.latitude <= 43.6513));
  const valid = rats.some(r => analysis.byRat[r].stats[metric].n);
  const verdicts = acceptance(analysis, metric, rat, vm.profile);
  const statusLabel = {pass: 'Within target', fail: 'Outside target', insufficient: 'Insufficient evidence'};
  $('report').innerHTML = `<div class="report-toolbar"><p class="note">The report uses the current metric, technology filters, thresholds and baseline.</p>
    <button id="print" class="primary">Print / Save PDF</button></div>
    <article class="report-sheet">
      <div class="overline">4G / 5G drive-test report</div>
      <h2>${title}</h2>
      <p class="identity"><b>${esc(test.id)}</b> · ${esc(scope.region)} / ${esc(scope.project)} / ${esc(scope.task_id)}</p>
      <p class="identity">Capture ${esc(utc(test.start))} to ${esc(utc(test.end))} · ${elapsed(test.end - test.start, true)}</p>
      ${test.kind === 'synthetic' ? '<p class="synthetic-note"><b>Synthetic demonstration.</b> The route observations and radio values are simulated for workflow evaluation.</p>' : ''}
      ${test.kind==='simulated'?'<p class="synthetic-note"><b>Uncalibrated planning received power.</b> Fixed-height isotropic UMa estimates; no measured RSRP, antenna tilt, interference, handover or service performance.</p>':''}
      <h3>Results summary</h3>
      ${table(['KPI', 'Result', 'Basis'], kpiRows(vm).map(([name, value, unit, detail]) => [name, [value, unit].filter(Boolean).join(' '), detail]))}
      <p class="note">${valid ? esc(reportFinding(vm, events)) : 'The selected technologies have no valid values for this metric.'}</p>
      <h3>Route and time series</h3>
      <div class="report-split">
        <div><canvas id="report-map" class="report-graphic" role="img" aria-label="GPS route and threshold status"></canvas>
          <p class="note">${within ? 'NDT snapshot · © OpenStreetMap contributors' : 'WGS84 GPS trace · north up'}</p></div>
        <div><canvas id="report-chart" class="report-graphic" role="img" aria-label="Selected metric over elapsed time"></canvas>
          <p class="note">${esc(def.label)} (${esc(def.unit)}) by elapsed time · dashed thresholds</p></div>
      </div>
      <div class="legend">${rats.map(r => legend(r, RAT_COLOR[r])).join('')}${legend('Outside threshold', ALERT_COLOR)}${legend('Metric missing', MISSING_COLOR)}</div>
      <p class="note">Applied rule · ${esc(rule)}. Gap cutoff ${vm.gap} s.</p>
      <h3>Capture quality</h3>
      <p class="note">${compact(test.count)} total observations · ${compact(analysis.gps)} GPS fixes · ${compact(gpsMissing)}
      without GPS · ${compact(analysis.geo.breaks)} recorded trace breaks. GPS totals cover both technologies.</p>
      <p class="note"><b>Selected metric assessment:</b> ${verdicts.map(c => `${c.rat} — ${statusLabel[c.status]}`).join(' · ')}.
      Profile ${esc(vm.profile.name)} · revision ${test.revision}.</p>
      ${footer(test, 1)}
    </article>
    <article class="report-sheet">
      <div class="overline">KPI distributions and comparison</div>
      <h2>Radio and service metrics</h2>
      <p class="identity">${esc(test.id)} · ${title} · ${rats.join(' + ')}</p>
      <h3>Per-technology distribution</h3>
      ${distribution(vm)}
      <h3>Baseline comparison · ${esc(def.label)}</h3>
      ${vm.baseline ? `<p class="identity">Baseline ${esc(vm.baseline.id)} · ${esc(vm.baseline.label)} · ${esc(utc(vm.baseline.start))}</p>` : ''}
      ${baseline}
      <p class="note">Percentiles use linear interpolation over valid values. Threshold percentages use valid observations as the denominator.
      Comparison deltas summarize each run’s full sample distribution. Route, time, device and traffic conditions may differ.</p>
      ${footer(test, 2)}
    </article>
    <article class="report-sheet">
      <div class="overline">Diagnostics and provenance</div>
      <h2>Event review</h2>
      <p class="identity">${esc(test.id)} · ${esc(test.label)} · elapsed times are relative to capture start</p>
      <p class="note">${counts.join(' · ')}</p>
      <h3>${events.length > 10 ? `First 10 of ${compact(events.length)} events` : 'Event detail'}</h3>
      ${events.length ? table(['Event', 'Elapsed', 'RAT', 'Detail'], events.slice(0, 10).map(({kind, label, row, end, worst, count}) =>
        [kind, elapsed(row.t - test.start, true), row.rat, worst ?
          `${label} · ${unitValue(worst[metric], def.unit)} worst · ${compact(count)} obs. through ${elapsed(end.t - test.start, true)}` : label])) :
        '<p class="note">No events in the selected view.</p>'}
      <h3>Analysis method</h3>
      <p class="note">Evidence gate per technology: at least ${vm.profile.minSamples} valid observations, ${vm.profile.minCoveragePct}% metric coverage,
      ${vm.profile.minGpsPct}% GPS coverage, and at most ${vm.profile.maxFailPct}% outside threshold. Missing evidence prevents a pass. Assessment covers the selected metric only.</p>
      <p class="note">A threshold excursion joins consecutive violating observations within the same technology up to the gap cutoff.
      A missing metric ends an excursion. Serving-cell changes use successive same-technology observations with comparable cell IDs or
      ARFCN/PCI pairs. These events record changes in observed identity. Handover attempts and outcomes require signaling evidence.</p>
      <p class="note">Recorded distance sums great-circle distances between consecutive GPS fixes within the gap cutoff.
      A timestamp with no GPS fix breaks the line. The map draws a recorded trace using the first valid fix when both technologies report at the same timestamp.</p>
      <p class="note">LTE reference-signal measurements follow the source export’s mapping to <a href="https://www.etsi.org/deliver/etsi_TS/136200_136299/136214/18.01.00_60/ts_136214v180100p.pdf">3GPP TS 36.214</a>.
      NR RF columns expect SS measurements as described in <a href="https://www.etsi.org/deliver/etsi_TS/138200_138299/138215/17.04.00_60/ts_138215v170400p.pdf">3GPP TS 38.215</a>.
      Thresholds are analyst settings.</p>
      <h3>Source record</h3>
      <p class="note">${esc(test.source)} · ${test.kind === 'synthetic' ? 'Synthetic demo' : test.kind==='simulated'?'Simulated; hash covers manifest and observations':'Imported CSV'} · ${esc(scope.region_id)} / ${esc(scope.project_id)} / ${esc(scope.task_id)}</p>
      ${test.notes ? `<p class="note">${esc(test.notes)}</p>` : ''}
      <p class="note hash">SHA-256 <span class="mono">${esc(test.sha256)}</span></p>
      ${vm.baseline ? `<p class="note hash">Baseline SHA-256 <span class="mono">${esc(vm.baseline.sha256)}</span></p>` : ''}
      ${footer(test, 3)}
    </article>${test.context?`<article class="report-sheet"><div class="overline">Task route and experiment provenance</div>
      <h2>Frozen route context</h2><p class="identity">${esc(test.id)} · ${esc(test.context.scope.task_id)} / ${esc(test.context.route.name)}</p>
      ${table(['Input','Saved value'],[['Route quality',test.context.route_quality],['Geometry SHA-256',test.context.geometry_hash],['Model',test.context.model||'Imported capture route association'],['Drive speed',test.context.case?test.context.case.speedKmh+' km/h':'Recorded capture timing'],['Profile',vm.profile.name],['Planning revision',test.context.context_hash]])}
      ${test.context.powers?`<h3>Effective planning transmitter powers</h3>${table(['Planning transmitter','EIRP dBm'],Object.entries(test.context.powers))}<p class="note">RAT is an assumed analysis label. Each site uses its lowest reported usable frequency. This isotropic planning model does not assign frequencies to verified live cells.</p>`:''}
      ${test.association?`<p class="note">Association ${esc(test.association.id)} · ${esc(test.association.direction)} · ${test.association.tolerance_m} m tolerance · ${fmtPercent(test.association.route_coverage_pct)} continuous route coverage.</p>`:''}
      ${vm.routeComparison?`<h3>Saved route comparison</h3>${table(['Comparison input','Saved result'],[['Mode',vm.routeComparison.mode],['A',vm.routeComparison.a_id],['B',vm.routeComparison.b_id],['Common coverage',fmtPercent(vm.routeComparison.common_coverage_pct)],['Median B minus A',(vm.routeComparison.median_delta??vm.routeComparison.median_delta_db)+' '+(vm.routeComparison.delta_unit||(METRICS[vm.routeComparison.metric].unit==='dBm'?'dB':METRICS[vm.routeComparison.metric].unit))],['Frozen profile',vm.routeComparison.profile.name]])}<p class="note">${vm.routeComparison.bin_m} m spatial bins. Export analysis for both inputs, matching rules, paired values and effective parameters.</p>`:''}
      ${footer(test,4)}</article>`:''}${test.issues?.length ? `<article class="report-sheet"><div class="overline">Investigation register</div>
      <h2>Recorded findings</h2><p class="identity">${esc(test.id)} · ${test.issues.filter(i => i.status === 'open').length} open issues · all technologies</p>
      <p class="note">${test.issues.length > 12 ? `First 12 of ${test.issues.length} findings. Export analysis for the complete register.` : 'Findings are analyst annotations linked to recorded observations.'}</p>
      <div class="findings-table">${table(['Finding / severity', 'Elapsed / RAT', 'Status', 'Notes'], test.issues.slice(0, 12).map(i => [
        `${i.title} · ${i.severity}`, `${elapsed(i.t - test.start, true)} / ${i.rat} / ${METRICS[i.metric].label}`, i.status, i.note.slice(0, 180)]))}</div>
      <p class="note">${test.issues.some(i => i.note.length > 180) ? 'Long notes are excerpted at 180 characters. The analysis JSON retains complete notes.' : ''}</p>
      ${footer(test, test.context?5:4)}</article>` : ''}`;
  const map = $('report-map'), chart = $('report-chart');
  const width = 380, height = 199;
  const mapCtx = setupCanvas(map, width, height, 2);
  const scene = drawRoute(mapCtx, width, height, {rows: vm.series, snapshot: within ? snapshot : null,
    metric, limits: vm.limits, gap: vm.gap, events});
  if (scene.scale) {
    const left = width - 11 - Math.max(36, scene.scaleWidth + 5);
    mapCtx.fillStyle = '#fff'; mapCtx.fillRect(left, height - 24, Math.max(36, scene.scaleWidth + 5), 17);
    mapCtx.strokeStyle = '#314b5d'; mapCtx.lineWidth = 1; mapCtx.beginPath();
    mapCtx.moveTo(left + 3, height - 10); mapCtx.lineTo(left + 3 + scene.scaleWidth, height - 10); mapCtx.stroke();
    mapCtx.fillStyle = '#314b5d'; mapCtx.textAlign = 'left'; mapCtx.font = '8px sans-serif';
    mapCtx.fillText(scene.scale, left + 3, height - 16);
  }
  drawTimeline(setupCanvas(chart, width, height, 2), width, height, vm, vm.series, rats);
  $('print').addEventListener('click', () => {
    const previous = document.title;
    document.title = `${test.id} Drive-Test Report`;
    window.print();
    document.title = previous;
  });
}
