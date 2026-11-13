import {acceptance, ALERT_COLOR, bands, elapsed, METRICS, MISSING_COLOR, RAT_COLOR, utc} from './test-model.mjs';
import {drawRoute, drawTimeline, setupCanvas} from './graphics.mjs';
import {$, compact, compareTable, distribution, esc, kpiRows, legend, table, unitValue} from './test-view.mjs';
import {scenarioChangeRows,antennaDescription,receiverDescription} from './scenario-comparison-model.mjs';
import {patternEvidenceLabel} from '../pattern-model.mjs';

const footer = (test, page) => `<div class="report-foot"><span>CongitV NDT Drive tests · ${esc(test.id)}${test.kind === 'synthetic' ? ' · Synthetic demonstration' : test.kind==='simulated'?' · Simulated planning power':''}</span><span class="section-number">Section ${page} of ${3+(test.issues?.length?1:0)+(test.context?1:0)+(test.context?.patternAssumptions?1:0)}</span></div>`;

function sourcePatternReport(test){
 const models=test.context.patternModels || [],frames=models.flatMap(p=>p.frequencyMHz.map((f,i)=>[p.name,f,p.peakGainDbi[i].toFixed(2),(100*p.efficiencies[i]).toFixed(2)+'%']));
 return `<article class="report-sheet"><div class="overline">Imported antenna model qualification</div><h2>Total realized gain source models</h2><p class="identity">${esc(test.id)} · ${models.length} frozen source models. First 20 models and 24 frequency frames shown; analysis JSON retains all samples, source records and checks.</p>${table(['Model / declared hardware','Reference / electrical state','Evidence / observation'],models.slice(0,20).map(p=>[`${p.name} / ${p.antennaModel} / ${p.portNames.join(', ')}`,`${p.referenceImpedanceOhm} ohm real reference, other ports matched / ${p.electricalState} / ${p.electricalTiltDeg}° embedded tilt / dimension ${p.maxDimensionM} m`,`${patternEvidenceLabel(p.evidence)} / ${p.observedAt}`]))}<h3>Power and coordinate convention</h3><p class="note">Absolute total realized gain includes mismatch and radiation loss at the real antenna-input reference. External feeder loss is separate; no extra peak antenna gain or array factor is added. Interpolation uses linear power in frequency and local compass-clockwise azimuth/elevation. The source electrical state is embedded; study azimuth, mechanical downtilt and roll orient the field. The frequency-interpolated peak is an upper bound.</p><p class="note">The complete occupied carrier must be covered by the source frequency range. Predictions use its center-frequency scalar response and the declared-dimension 2D²/wavelength far-field rule. Full-sphere shape, seam/poles and passive-power conservation were checked. Source claims and physical deployment are not independently verified. ${test.context.receiverAssumptions?'Model-2 receiver polarization is a separate study assumption, not source polarized field data. No coherent inter-port phases or calibrated field accuracy is established.':'No receiver polarization, coherent inter-port phases or calibrated field accuracy is established.'}</p><h3>Frozen frequency-frame checks</h3>${table(['Model','MHz','Peak bound dBi','Integrated efficiency'],frames.slice(0,24))}<h3>Source evidence</h3>${table(['Pattern','Source record / URI','Radiation SHA-256'],models.slice(0,20).map(p=>[p.patternId,`${p.sourceRecordId} / ${p.sourceTitle} / ${p.sourceURI}`,p.radiationSha256]))}${footer(test,5)}</article>`;
}

function sourceCellTables(context){
 const selected=context.transmitters.filter(t=>(t.rat || t.template?.rat)===context.rat),allPorts=context.transmitters.flatMap(cell=>(cell.ports || []).map(port=>({cell,port}))),budgets=context.radioScenario.payload.radioBudgets || {};
 const sum=values=>{const top=Math.max(...values);return top+10*Math.log10(values.reduce((n,v)=>n+10**((v-top)/10),0));};
 const eirp=t=>t.powerDbm+t.gainDbi-t.lossDb+(t.pattern==='array'?10*Math.log10(t.array.rows*t.array.columns):0);
 const delta=cell=>Object.hasOwn(context.powers,cell.id)?context.powers[cell.id]-sum((cell.ports || [{template:cell.template}]).map(p=>eirp(p.template))):0;
 const ports=selected.flatMap(cell=>(cell.ports || [{template:cell.template}]).map(port=>[cell.cellIdentity || cell.label,port.radioId?`${port.radioId} / ${port.radioPortName || port.radioPortId} → ${port.antennaPortName || port.antennaPortId}`:'Legacy site template',`${port.template.rat} ${port.template.carrier.band} / ${port.template.frequencyMHz} MHz / ${port.template.bandwidthMHz} MHz`,`${antennaDescription(port.template)} / ${port.template.azimuthDeg}° az / ${port.template.tiltDeg}° down / ${port.template.mode}`,`${(port.template.powerDbm+delta(cell)).toFixed(1)} dBm`]));
 return `<h3>Frozen source cells and port allocations</h3><p class="note">${selected.length} selected-RAT cells / ${ports.length} paths. First 20 paths shown; analysis JSON retains every assignment, source link and assumption.</p><div class="report-source-ports">${table(['Cell','Radio / path','Carrier','Antenna / orientation','TX power'],ports.slice(0,20))}</div><h3>Modeled radio power budgets · all assigned technologies</h3>${table(['Radio','Allocated dBm','Budget dBm'],Object.entries(budgets).slice(0,20).map(([id,budget])=>[id,sum(allPorts.filter(p=>p.port.radioId===id).map(p=>p.port.template.powerDbm+delta(p.cell))).toFixed(1),Number(budget).toFixed(1)]))}<p class="note">First 20 radios shown; JSON retains all budgets. Uncorrelated mean port powers sum within each cell. ${context.receiverAssumptions?`Receiver: ${esc(receiverDescription(context.radioScenario.payload.receiver))}; valid zero-power ports do not block other supported port power.`:'Ideal polarization-insensitive power collection.'} Strongest supported cell per RAT. A cell is unavailable if any assigned path is outside the model domain. Parameter B scales every target-cell port by the same dB change and rechecks shared-radio budgets across LTE and NR.</p><p class="note">Fixed UMa heights and supported Release 18 carrier subset. No MIMO, coherent inter-port phases, reference-signal allocation, interference or calibrated field accuracy. Reported source data and modeled antenna/power assumptions remain distinct.</p>`;
}

function receiverReport(context){
 if(!context.receiverAssumptions)return '';
 const receiver=context.radioScenario?.payload.receiver;
 return `<h3>LOS reference receiver</h3>${table(['Frozen receiver input','Value'],[['This member',receiverDescription(receiver)],['Field basis','TR 38.901 Model-2 local linear fields; reciprocal LOS projection in a shared local East/North/Up link frame'],['Port collection','Uncorrelated mean port powers; an ideal zero-power port does not block another supported port'],['Numerical null',`Power fraction below ${context.receiverAssumptions.nullPowerFraction} is zero; no finite dBm value`]])}<p class="note">Scalar source gain does not provide polarized vendor fields. Transmitter polarization is a separate study assumption. Explicit receiver roles require LOS. Members without an explicit receiver keep their own ideal collection and environment. No NLOS depolarization, coherent multi-panel/port combining, MIMO, interference or field calibration is established.</p>`;
}

const fmtPercent=value=>Number(value).toFixed(1)+'%';
// Archived v1 manifests predate saved reference metadata.
const legacyReferences=[{title:'3GPP TR 38.901 v18.0.0',url:'https://www.etsi.org/deliver/etsi_tr/138900_138999/138901/18.00.00_60/tr_138901v180000p.pdf'}];

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

export function renderReport(vm, snapshot,rfReview=null) {
  const {test, metric, analysis, rat} = vm, {scope} = test, def = METRICS[metric];
  if(rfReview?.currentId!==test.id)rfReview=null;
  const radioScenario=test.context?.radioScenario,inventory=test.context?.inventorySnapshot,scenarioComparison=test.context?.scenarioComparison;
  const transmitterNames=new Map((test.context?.transmitters || []).map(t=>[t.id,t.label || t.site_id || t.id]));
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
      ${test.kind==='simulated'?`<p class="synthetic-note"><b>Uncalibrated planning received power.</b> ${radioScenario?'Fixed-height UMa with saved carrier/orientation and qualified scalar antenna templates. Deployment, terrain/clutter, interference and service performance remain unverified.':'Fixed-height isotropic UMa estimates; no measured RSRP, antenna tilt, interference, handover or service performance.'}</p>`:''}
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
      ${test.kind==='simulated'?`<p class="note">Model references: ${(test.context?.modelReferences || legacyReferences).filter(r=>!r.rat || r.rat===test.context.rat).map(r=>`<a href="${esc(r.url)}">${esc(r.title)}</a>`).join(' · ')}. Planning received power has no reference-signal/resource allocation and is not measured RSRP.</p>`:`<p class="note">LTE reference-signal measurements follow the source export’s mapping to <a href="https://www.etsi.org/deliver/etsi_TS/136200_136299/136214/18.01.00_60/ts_136214v180100p.pdf">3GPP TS 36.214</a>.
      NR RF columns expect SS measurements as described in <a href="https://www.etsi.org/deliver/etsi_TS/138200_138299/138215/17.04.00_60/ts_138215v170400p.pdf">3GPP TS 38.215</a>.
      Thresholds are analyst settings.</p>`}
      <h3>Source record</h3>
      <p class="note">${esc(test.source)} · ${test.kind === 'synthetic' ? 'Synthetic demo' : test.kind==='simulated'?'Simulated; hash covers manifest and observations':'Imported CSV'} · ${esc(scope.region_id)} / ${esc(scope.project_id)} / ${esc(scope.task_id)}</p>
      ${test.notes ? `<p class="note">${esc(test.notes)}</p>` : ''}
      <p class="note hash">SHA-256 <span class="mono">${esc(test.sha256)}</span></p>
      ${vm.baseline ? `<p class="note hash">Baseline SHA-256 <span class="mono">${esc(vm.baseline.sha256)}</span></p>` : ''}
      ${footer(test, 3)}
    </article>${test.context?`<article class="report-sheet"><div class="overline">Task route and experiment provenance</div>
      <h2>Frozen route context</h2><p class="identity">${esc(test.id)} · ${esc(test.context.scope.task_id)} / ${esc(test.context.route.name)}</p>
      ${table(['Input','Saved value'],[['Route quality',test.context.route_quality],['Geometry SHA-256',test.context.geometry_hash],['Model',test.context.model||'Imported capture route association'],['Drive speed',test.context.case?test.context.case.speedKmh+' km/h':'Recorded capture timing'],['Profile',vm.profile.name],['Planning revision',test.context.context_hash],...(radioScenario?[['Frozen scenario',`${radioScenario.name || radioScenario.payload.name} / revision ${radioScenario.revision}`],['Library baseline pointer',radioScenario.baselineRevision ?? 'None']]:[]),...(inventory?[['Regional source fingerprint',inventory.regionalFingerprint],[inventory.sourceSiteKind || 'Contributing licensed locations',(inventory.sourceSites || inventory.licensedSites || []).length],['Equipment source',inventory.operatorEquipment?`Revision ${inventory.operatorEquipment.revision} / SHA-256 ${inventory.operatorEquipment.sha256}`:'No equipment file imported']]:[])])}
      ${scenarioComparison?`<p class="note"><b>A baseline revision ${scenarioComparison.baselineRevision} / B applied revision ${scenarioComparison.appliedRevision}.</b> This member is ${esc(test.context.variant)}, using revision ${radioScenario.revision}. Route, speed and sampling are shared. Each member uses its own frozen templates.</p>`:''}
      ${radioScenario && !test.context.cellAssumptions?`<h3>Frozen directional templates</h3>${table(['Planning transmitter','Carrier / pattern','Orientation / environment',test.context.arrayAssumptions?'EIRP upper bound dBm':'EIRP dBm'],test.context.transmitters.filter(t=>t.template.rat===test.context.rat).map(t=>[t.label || t.site_id,`${t.template.rat} ${t.template.carrier.band} / ${t.template.frequencyMHz} MHz / ${t.template.bandwidthMHz} MHz / ${antennaDescription(t.template)}`,`${t.template.azimuthDeg} deg azimuth / ${t.template.tiltDeg} deg downtilt / ${t.template.mode}`,Number(test.context.powers[t.id]).toFixed(1)]))}<p class="note">Carrier checks use the pinned Release 18 subset of TS 36.104/38.104 v18.5.0. Reference-element attenuation follows TR 38.901 v18.0.0 table 7.3-1. ${scenarioComparison?'A uses the baseline revision; B uses the applied revision.':'A starts from the applied revision; B changes one transmitter EIRP. The library baseline pointer is recorded separately.'} These are study assignments; imported equipment and vendor cuts remain source evidence.</p>`:''}
      ${receiverReport(test.context)}
      ${test.context.cellAssumptions?sourceCellTables(test.context):''}
      ${test.context.arrayAssumptions?'<p class="note">Array power is shared across elements; coherent gain is included once. EIRP is an upper bound before element scan attenuation. Ideal array null attenuation is capped at 120 dB. Uniform single-panel, single-polarization, far-field narrowband model; no coupling, vendor pattern or coherent inter-port allocation.</p>':''}
      ${scenarioComparison?`<div class="report-comparison"><h3>Changed template inputs</h3><p class="note">${test.context.scenarioChanges.length} changed inputs in ${esc(test.context.rat)} assignments${test.context.scenarioChanges.length>20?' · first 20 shown; export retains all':''}. Recorded-only fields do not change the mean-power arithmetic.</p>${test.context.scenarioChanges.length?table(['Planning site','Input','A baseline','B applied'],scenarioChangeRows(test.context.scenarioChanges.slice(0,20))):'<p class="note">No input changes; zero-change comparison.</p>'}</div>`:''}
      ${test.context.powers && !radioScenario?`<h3>Effective planning transmitter powers</h3>${table(['Planning transmitter','EIRP dBm'],Object.entries(test.context.powers).filter(([id])=>!radioScenario || test.context.transmitters.some(t=>t.id===id && t.template.rat===test.context.rat)).map(([id,power])=>[transmitterNames.get(id)||id,power]))}<p class="note">${radioScenario?'A uses the frozen template powers; B changes the selected transmitter EIRP. Carrier power is per modeled port, with peak gain and feeder loss already accounted for. The library baseline pointer is retained as provenance.':'RAT is an assumed analysis label. Each site uses its lowest reported usable frequency. This isotropic planning model does not assign frequencies to verified live cells.'}</p>`:''}
      ${test.association?`<p class="note">Association ${esc(test.association.id)} · ${esc(test.association.direction)} · ${test.association.tolerance_m} m tolerance · ${fmtPercent(test.association.route_coverage_pct)} continuous route coverage.</p>`:''}
      ${vm.routeComparison?`<div class="report-comparison"><h3>Saved route comparison</h3>${table(['Comparison input','Saved result'],[['Mode',vm.routeComparison.mode],['A',vm.routeComparison.a_id],['B',vm.routeComparison.b_id],['Common coverage',fmtPercent(vm.routeComparison.common_coverage_pct)],['Median B minus A',unitValue(vm.routeComparison.median_delta??vm.routeComparison.median_delta_db,vm.routeComparison.delta_unit||(METRICS[vm.routeComparison.metric].unit==='dBm'?'dB':METRICS[vm.routeComparison.metric].unit))],['Frozen profile',vm.routeComparison.profile.name]])}<p class="note">${vm.routeComparison.bin_m} m spatial bins. Export analysis for both inputs, matching rules, paired values and effective parameters.</p></div>`:''}
      ${rfReview?`<div class="report-comparison"><h3>Frozen RF result review</h3><p class="note">${esc(rfReview.targetLabel)}. Read-only numerical replay; experiment acceptance and field accuracy are unchanged. Counts refer to sampled observations, not area or route-distance coverage.</p>${table(['RF diagnostic input / result','Frozen value'],[['Current run',rfReview.currentId],['Reference run',rfReview.referenceId || 'None'],['Models',rfReview.models.join(' / ')],['Supported current samples',`${rfReview.summary.supported} / ${rfReview.summary.total}`],['Unavailable current samples',rfReview.summary.unavailable],['Paired finite samples',rfReview.summary.paired],['Study threshold',`${rfReview.threshold} dBm`],['Sensitivity',rfReview.margin===null?'Field uncertainty not quantified':`±${rfReview.margin} dB bounded study sensitivity per run; delta bound ±${2*rfReview.margin} dB`]])}<p class="note">Any range is a user-entered bounded study sensitivity, not a confidence interval. No error cancellation, measured calibration or service improvement is inferred. RF review JSON retains the full sample trace, source contexts and selected path diagnostics.</p></div>`:''}
      ${footer(test,4)}</article>`:''}${test.context?.patternAssumptions?sourcePatternReport(test):''}${test.issues?.length ? `<article class="report-sheet"><div class="overline">Investigation register</div>
      <h2>Recorded findings</h2><p class="identity">${esc(test.id)} · ${test.issues.filter(i => i.status === 'open').length} open issues · all technologies</p>
      <p class="note">${test.issues.length > 12 ? `First 12 of ${test.issues.length} findings. Export analysis for the complete register.` : 'Findings are analyst annotations linked to recorded observations.'}</p>
      <div class="findings-table">${table(['Finding / severity', 'Elapsed / RAT', 'Status', 'Notes'], test.issues.slice(0, 12).map(i => [
        `${i.title} · ${i.severity}`, `${elapsed(i.t - test.start, true)} / ${i.rat} / ${METRICS[i.metric].label}`, i.status, i.note.slice(0, 180)]))}</div>
      <p class="note">${test.issues.some(i => i.note.length > 180) ? 'Long notes are excerpted at 180 characters. The analysis JSON retains complete notes.' : ''}</p>
      ${footer(test,4+(test.context?1:0)+(test.context?.patternAssumptions?1:0))}</article>` : ''}`;
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
