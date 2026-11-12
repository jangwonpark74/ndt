import * as api from './test-data.mjs';
import {bindExperiments} from './experiment-view.mjs';
import {renderAlignedComparison} from './comparison-view.mjs';
import {analysisPackage, bands, DEFAULT_PROFILE, METRICS, utc} from './test-model.mjs';
import {CHART_PAD, drawTimeline, setupCanvas} from './graphics.mjs';
import {makeMap} from './map-view.mjs';
import {renderReport} from './report-view.mjs';
import {Workspace} from './test-view-model.mjs';
import {$, populateRegistry, renderAnalytics, renderCDF, renderCursor, renderEvents, renderHeading, selectedEvents} from './test-view.mjs';
import {renderInvestigations, renderQuality, renderSamples, sampleRows, updateSampleCursor} from './review-view.mjs';

const query = new URLSearchParams(location.search);
const scope={region_id:query.get('region')||'',project_id:query.get('project')||'',task_id:query.get('task')||'',route_id:query.get('route')||''};
const vm = new Workspace(api,{cancel:id=>cancelAnimationFrame(id),request:callback=>requestAnimationFrame(callback),now:()=>performance.now()},scope);
let selectedPlanningTask,selectedRouteId;
let leaving=false;

let chartX, snapshot, eventsLimit = 40, activeRequestId, lastMapSample;
const chart = $('chart'), show = (id, visible) => { $(id).hidden = !visible; };
const explorer = {search: '', status: 'all', page: 0};
const map = makeMap($('route-canvas'), $('live-map'), $('map-mode'), $('map-status'), $('map-attribution'), $('map-scale'), $('snapshot-controls'),
  row => vm.jump(row));

function drawChart() {
  if (!vm.test || !chart.clientWidth) return;
  const width = chart.clientWidth, height = chart.clientHeight;
  chartX = drawTimeline(setupCanvas(chart, width, height), width, height, vm, vm.series, bands(vm.rat));
  renderCursor(vm, chartX);
}

function selectTab(tab) {
  const tabs = ['replay', 'analytics', 'investigate', 'report'];
  const restoreFocus = tabs.some(name => name !== tab && $(name).contains(document.activeElement));
  vm.stop();
  vm.tab = tab;
  for (const button of document.querySelectorAll('[data-tab]')) {
    if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const name of tabs) show(name, name === tab);
  if (tab === 'analytics' && vm.test) {renderAnalytics(vm);renderAligned();}
  if (tab === 'investigate' && vm.test) renderInvestigations(vm, explorer);
  if (tab === 'report' && vm.test) renderReport(vm, snapshot);
  if (tab === 'replay' && vm.test) {
    map.update(vm, false);
    drawChart();
  }
  if (restoreFocus) document.querySelector(`[data-tab="${tab}"]`).focus({preventScroll: true});
}

vm.listen(change => {
  if(leaving)return;
  if (change === 'cursor') {
    renderCursor(vm, chartX);
    $('flag-sample').disabled = !vm.selected || vm.loading || vm.saving;
    $('flag-explorer').disabled = !vm.selected || vm.loading || vm.saving;
    if (vm.tab === 'investigate') updateSampleCursor(vm);
    if (vm.selected !== lastMapSample) {
      lastMapSample = vm.selected;
      map.cursor();
    }
    return;
  }
  const {test, error} = vm;
  for(const button of document.querySelectorAll('[data-tab]')){
    button.disabled=!test;
    if(!test)button.removeAttribute('aria-current');
  }
  if(!test)$('setup-open').setAttribute('aria-current','page');else $('setup-open').removeAttribute('aria-current');
  show('welcome', !test);
  show('workspace', Boolean(test));
  show('message', Boolean(error) || vm.loading);
  $('message').textContent = error || 'Loading Test ID…';
  for (const id of ['export', 'package', 'rules', 'rat', 'metric', 'reload', 'import']) $(id).disabled = vm.loading || vm.saving || (!test && !['reload', 'import'].includes(id));
  $('flag-sample').disabled = $('flag-explorer').disabled = !vm.selected || vm.loading || vm.saving;
  if (!test) $('welcome').textContent = vm.loading ? 'Loading Test IDs…' : 'Import a run to open the workspace.';
  if (change === 'busy' && vm.loading) return;
  if (change === 'full' || change === 'test' || change === 'busy') populateRegistry(vm);
  if (!test || change === 'busy') return;
  if (change === 'test') {
    const url = new URL(location.href);
    url.searchParams.set('test', test.id);
    history.replaceState(null, '', url);
    explorer.page = 0;
  }
  renderRouteContext();
  for(const button of document.querySelectorAll('[data-tab]'))button.disabled=!test;
  if (change !== 'comparison') {
    renderHeading(vm);
    renderQuality(vm);
    eventsLimit = 40;
    renderEvents(vm, eventsLimit);
    map.update(vm, change === 'test');
    drawChart();
  }
  if (vm.tab === 'analytics') {
    const focused = document.activeElement?.id === 'baseline';
    renderAnalytics(vm);
    renderAligned();
    if (focused) $('baseline')?.focus();
  }
  if (vm.tab === 'report') renderReport(vm, snapshot);
  if (vm.tab === 'investigate') renderInvestigations(vm, explorer);
});

new ResizeObserver(drawChart).observe(chart);
new ResizeObserver(() => { if (vm.test && vm.tab === 'analytics') renderCDF(vm); }).observe($('main'));

for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => selectTab(button.dataset.tab));
$('metric').innerHTML = Object.entries(METRICS).map(([key, def]) => `<option value="${key}">${def.label}</option>`).join('');
$('metric').addEventListener('change', event => {
  vm.setAnalysis({metric: event.target.value});
});
$('rat').addEventListener('change', event => vm.setAnalysis({rat: event.target.value}));
$('search').addEventListener('input', () => populateRegistry(vm));
$('test-list').addEventListener('click', async event => {
  const id = event.target.closest('[data-id]')?.dataset.id;
  if (!id || id === vm.test?.id || vm.saving) return;
  const keyboard = event.detail === 0;
  await vm.open(id);
  if (keyboard) $('test-list').querySelector('[aria-pressed=true]')?.focus();
});
$('analytics').addEventListener('change', event => { if (event.target.id === 'baseline') vm.compare(event.target.value); });
$('reload').addEventListener('click', () => vm.start(vm.test?.id || query.get('test')));
$('browse-samples').addEventListener('click', () => selectTab('investigate'));
$('sample-search').addEventListener('input', event => { explorer.search = event.target.value; explorer.page = 0; renderSamples(vm, explorer); });
$('sample-status').addEventListener('change', event => { explorer.status = event.target.value; explorer.page = 0; renderSamples(vm, explorer); });
for (const [id, step] of [['samples-prev', -1], ['samples-next', 1]]) $(id).addEventListener('click', () => { explorer.page += step; renderSamples(vm, explorer); });
$('sample-table').addEventListener('click', event => {
  const index = event.target.closest('[data-sample]')?.dataset.sample;
  if (index === undefined) return;
  vm.jump(sampleRows(vm, explorer)[Number(index)]);
  selectTab('replay');
  $('sample-time').scrollIntoView({block: 'nearest'});
  $('flag-sample').focus({preventScroll: true});
});
$('issues').addEventListener('click', async event => {
  const jump = event.target.closest('[data-issue-jump]'), status = event.target.closest('[data-issue-status]');
  if (jump) {
    const issue = vm.test.issues.find(i => i.id === jump.dataset.issueJump);
    const row = vm.test.rows.find(r => r.t === issue.t && r.rat === issue.rat);
    vm.setAnalysis({rat: issue.rat, metric: issue.metric});
    vm.jump(row); selectTab('replay'); $('flag-sample').focus();
  }
  if (status) {
    const issueId = status.dataset.issueStatus;
    status.disabled = true;
    try { await vm.setIssueStatus(status.dataset.issueStatus, status.dataset.status); }
    catch (error) { $('message').textContent = error.message; show('message', true); }
    finally { status.disabled = false; document.querySelector(`[data-issue-status="${issueId}"]`)?.focus({preventScroll: true}); }
  }
});
$('fit').addEventListener('click', map.fit);
$('play').addEventListener('click', () => vm.toggle());
$('previous').addEventListener('click', () => vm.step(-1));
$('next').addEventListener('click', () => vm.step(1));
$('speed').addEventListener('change', event => { vm.speed = Number(event.target.value); });
$('scrub').addEventListener('input', event => {
  vm.stop(); vm.seek(vm.test.start + Number(event.target.value));
});
chart.addEventListener('click', event => {
  if (!vm.test) return;
  const {left, width} = chart.getBoundingClientRect();
  const share = Math.max(0, Math.min(1, (event.clientX - left - CHART_PAD.left) / (width - CHART_PAD.left - CHART_PAD.right)));
  vm.stop(); vm.seek(vm.test.start + share * (vm.test.end - vm.test.start));
});
$('event-kind').addEventListener('change', event => {
  vm.eventKind = event.target.value;
  renderEvents(vm, eventsLimit = 40);
});
$('events').addEventListener('click', event => {
  if (event.target.id === 'more-events') {
    const next = eventsLimit;
    renderEvents(vm, eventsLimit += 40);
    $('events').querySelector(`[data-event="${next}"]`)?.focus();
    return;
  }
  const index = event.target.closest('[data-event]')?.dataset.event;
  if (index !== undefined) vm.jump(selectedEvents(vm)[Number(index)].row);
});

const header = ['timestamp', 'latitude', 'longitude', 'rat', 'band', 'pci', 'arfcn', 'cell_id',
  'rsrp_dbm', 'rsrq_db', 'sinr_db', 'dl_mbps', 'ul_mbps', 'latency_ms', 'predicted_rx_dbm', 'event'];
function download(filename, content, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(value) {
  if (value == null) return '';
  if (typeof value !== 'string') return String(value);
  const text = /^[=+@\-\t\r]/.test(value) ? "'" + value : value;
  return '"' + text.replaceAll('"', '""') + '"';
}
$('export').addEventListener('click', () => {
  const lines = [header.join(',')];
  for (const row of vm.test.rows) lines.push(header.map(key =>
    csvCell(key === 'timestamp' ? new Date(row.t).toISOString() : row[key])).join(','));
  download(`${vm.test.id}.csv`, lines.join('\r\n') + '\r\n');
});
$('package').addEventListener('click', () => {
  download(`${vm.test.id}-analysis.json`, JSON.stringify(analysisPackage(vm), null, 2) + '\n', 'application/json');
});
$('template').addEventListener('click', () => {
  download('drive-test-dm-template.csv', header.join(',') + '\r\n' +
    '2026-11-09T14:10:00Z,43.64036,-79.39472,NR,n78,412,640128,N-412,-91.2,-10.4,18.3,125.1,20.2,21,\r\n');
});

const importDialog = $('import-dialog'), importForm = $('import-form');
$('import').addEventListener('click', () => {
  const list = $('planning');
  list.length = 1;
  for (const task of vm.catalog.tasks || []) {
    const region = vm.catalog.regions.find(r => r.id === task.region_id);
    const project = region?.projects.find(p => p.id === task.project_id);
    const label = [region?.name || task.region_id, project?.name || task.project_id, task.task_id, task.task].join(' / ');
    list.add(new Option(label, [task.region_id, task.project_id, task.task_id].join('/')));
  }
  const selected=selectedPlanningTask||scope;
  for(const [name,key] of [['Region','region_id'],['Project','project_id'],['Task','task_id']])if(selected[key])importForm.elements.namedItem(name).value=selected[key];
  if(selected.region_id&&selected.project_id&&selected.task_id)list.value=[selected.region_id,selected.project_id,selected.task_id].join('/');
  $('catalog-status').textContent = vm.catalog.message || '';
  show('catalog-status', Boolean(vm.catalog.message));
  importDialog.showModal();
});
$('planning').addEventListener('change', event => {
  if (!event.target.value) return;
  const ids = event.target.value.split('/');
  ['Region', 'Project', 'Task'].forEach((key, i) => { importForm.elements.namedItem(key).value = ids[i]; });
  activeRequestId = null;
});
importForm.addEventListener('input', () => { activeRequestId = null; show('import-error', false); });
importForm.addEventListener('submit', async event => {
  event.preventDefault();
  const file = $('file').files[0];
  if (!file || !file.size || file.size > 16 * 1024 * 1024) {
    $('import-error').textContent = 'Select a CSV file between 1 byte and 16 MiB.';
    return show('import-error', true);
  }
  const details = Object.fromEntries([...new FormData(importForm)].map(([key, value]) => [key, value.trim()]));
  activeRequestId ||= crypto.randomUUID();
  const fields = [...importForm.elements];
  fields.forEach(field => { field.disabled = true; });
  $('import-submit').textContent = 'Importing…';
  show('import-error', false);
  try {
    const saved = await vm.importFile(file, details, activeRequestId);
    importForm.reset(); activeRequestId = null;
    $('search').value = '';
    populateRegistry(vm);
    importDialog.close();
    selectTab('replay');
    $('message').textContent = vm.error ? `Saved ${saved.id}. Open it from the registry to retry loading.` : `Saved ${saved.id}.`;
    show('message', true);
  } catch (error) {
    $('import-error').textContent = error.message;
    show('import-error', true);
  } finally {
    fields.forEach(field => { field.disabled = false; });
    $('import-submit').textContent = 'Create Test ID';
  }
});
importDialog.addEventListener('cancel', event => { if ($('import-submit').disabled) event.preventDefault(); });

const rulesDialog = $('rules-dialog');
function fillRules(profile) {
  const limits = profile.thresholds[vm.metric];
  $('limit-lte').value = limits.LTE;
  $('limit-nr').value = limits.NR;
  for (const [id, key] of [['gap', 'gap'], ['profile-name', 'name'], ['min-samples', 'minSamples'], ['max-fail', 'maxFailPct'], ['min-coverage', 'minCoveragePct'], ['min-gps', 'minGpsPct']]) $(id).value = profile[key];
}
function openRules() {
  const def = METRICS[vm.metric];
  $('rules-context').textContent = `${def.label} (${def.unit}) · flag values ${def.bad} the threshold.`;
  const bounds = {predicted_rx_dbm:[-300,90],rsrp_dbm: [-180, 0], rsrq_db: [-60, 30], sinr_db: [-60, 80],
    dl_mbps: [0, 100000], ul_mbps: [0, 100000], latency_ms: [0, 3600000]}[vm.metric];
  for (const input of [$('limit-lte'), $('limit-nr')]) [input.min, input.max] = bounds;
  fillRules(vm.profile);
  show('rules-error', false);
  rulesDialog.showModal();
}
$('rules').addEventListener('click', openRules);
$('quality-summary').addEventListener('click', event => { if (event.target.id === 'edit-profile' && !vm.loading && !vm.saving) openRules(); });
$('reset-rules').addEventListener('click', () => fillRules(DEFAULT_PROFILE));
$('rules-form').addEventListener('submit', async event => {
  event.preventDefault();
  const profile = structuredClone(vm.profile);
  profile.thresholds[vm.metric] = {LTE: $('limit-lte').valueAsNumber, NR: $('limit-nr').valueAsNumber};
  for (const [id, key] of [['gap', 'gap'], ['min-samples', 'minSamples'], ['max-fail', 'maxFailPct'], ['min-coverage', 'minCoveragePct'], ['min-gps', 'minGpsPct']]) profile[key] = $(id).valueAsNumber;
  profile.name = $('profile-name').value.trim();
  const fields = [...event.target.elements];
  fields.forEach(f => { f.disabled = true; });
  show('rules-error', false);
  try { await vm.saveProfile(profile); rulesDialog.close(); }
  catch (error) { $('rules-error').textContent = error.message; show('rules-error', true); }
  finally { fields.forEach(f => { f.disabled = false; }); }
});
rulesDialog.addEventListener('cancel', event => { if (vm.saving) event.preventDefault(); });

const issueDialog = $('issue-dialog');
let draftIssue;
function flagSample() {
  if (!vm.selected || vm.loading || vm.saving) return;
  const {t, rat} = vm.selected;
  draftIssue = {id: crypto.randomUUID(), t, rat, metric: vm.metric};
  $('issue-form').reset();
  $('issue-context').textContent = `${rat} · ${METRICS[vm.metric].label} · ${utc(t)}`;
  show('issue-error', false);
  issueDialog.showModal();
}
for (const id of ['flag-sample', 'flag-explorer']) $(id).addEventListener('click', flagSample);
$('issue-form').addEventListener('input', () => { if (draftIssue) draftIssue.id = crypto.randomUUID(); });
$('issue-form').addEventListener('submit', async event => {
  event.preventDefault();
  const fields = [...event.target.elements];
  const issue = {...draftIssue, title: $('issue-title').value.trim(), note: $('issue-note').value.trim(), severity: $('issue-severity').value};
  fields.forEach(f => { f.disabled = true; });
  show('issue-error', false);
  try { await vm.saveIssue(issue); issueDialog.close(); selectTab('investigate'); }
  catch (error) { $('issue-error').textContent = error.message; show('issue-error', true); }
  finally { fields.forEach(f => { f.disabled = false; }); }
});
issueDialog.addEventListener('cancel', event => { if (vm.saving) event.preventDefault(); });
for (const button of document.querySelectorAll('.dismiss, .cancel')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}
function planningLink(context) {
  const params=new URLSearchParams();
  for(const [field,name] of [['region_id','region'],['project_id','project'],['task_id','task']])if(context?.[field])params.set(name,context[field]);
  $('back-planning').href='/?'+params;
  $('scope-label').textContent=context?.task_id?`${context.region||context.region_id} / ${context.project||context.project_id} / ${context.task||context.task_id}`:'Select a saved Task to begin';
}
function renderRouteContext(){
  const test=vm.test;if(!test)return;
  const context=test.context;
  $('associate-route').disabled=!selectedPlanningTask||test.kind==='simulated'||!selectedRouteId;
  $('association-direction').disabled=test.kind==='simulated';
  $('route-context-status').textContent=context?`${context.scope.task_id} / ${context.route.name} · ${context.route_quality} · ${test.association?`${test.association.matched_samples} matched observations · ${test.association.route_coverage_pct.toFixed(1)}% continuous route coverage`:context.case?.speedKmh+' km/h'} · frozen route ${context.geometry_hash.slice(0,12)}`:'This capture has no Task-route association. Select its saved Task route above to align it.';
  planningLink(context?.scope||test.scope);
}
function renderAligned(){renderAlignedComparison(vm,async()=>{
  try {vm.routeComparison=await api.compareRoutes({a_id:vm.baseline.id,b_id:vm.test.id,metric:vm.metric,rat:vm.rat,profile:vm.profile});vm.emit('comparison');}
  catch(error){$('message').textContent=error.message;show('message',true);}
},chainage=>{
  const matches=vm.test.association?.samples;
  const candidates=vm.series.map(row=>({row,s:row.chainage_m??matches?.find(m=>m.t===row.t&&m.rat===row.rat&&m.status==='matched')?.chainage_m})).filter(item=>Number.isFinite(item.s));
  candidates.sort((a,b)=>Math.abs(a.s-chainage)-Math.abs(b.s-chainage));
  if(candidates[0]){vm.jump(candidates[0].row);selectTab('replay');$('sample-time').scrollIntoView({block:'center'});}
});}
$('associate-route').onclick=async()=>{
  if(!selectedPlanningTask||!vm.test)return;
  const task=selectedPlanningTask;
  try{vm.test=await api.associateRoute(vm.test.id,{region_id:task.region_id,project_id:task.project_id,task_id:task.task_id,route_id:selectedRouteId,context_hash:task.context_hash,direction:$('association-direction').value});vm.emit('analysis');}
  catch(error){$('message').textContent=error.message;show('message',true);}
};
planningLink(scope);
await vm.start(query.get('test'));
const experiments=bindExperiments({api,clock:{set:(callback,delay)=>setTimeout(callback,delay),clear:id=>clearTimeout(id)},scope,download,
  onContext(task,routeId){
    selectedPlanningTask=task;selectedRouteId=routeId;
    if(task){
      const next={region_id:task.region_id,project_id:task.project_id,task_id:task.task_id};
      const changed=Object.keys(next).some(k=>vm.scope[k]!==next[k]);vm.scope=next;
      const url=new URL(location.href);for(const [k,name]of [['region_id','region'],['project_id','project'],['task_id','task']])url.searchParams.set(name,next[k]);
      url.searchParams.set('route',routeId);history.replaceState(null,'',url);planningLink(task);
      if(changed)vm.start();
    }
    renderRouteContext();
  },
  async openRun(id,experiment){
    try{
      vm.scope=experiment.snapshot.scope;if(vm.test?.id!==id)await vm.start(id);
      if(leaving)return;
      const comparison=experiment.comparisons.find(c=>c.b_id===id);
      if(comparison){if(vm.baseline?.id!==comparison.a_id)await vm.compare(comparison.a_id);if(leaving)return;vm.routeComparison=comparison;vm.emit('analysis');}
      const url=new URL(location.href);url.searchParams.set('experiment',experiment.id);history.replaceState(null,'',url);
    }catch(error){if(!leaving){vm.error=error.message;vm.emit('busy');}}
  }
});
await experiments.load(vm.catalog.tasks?.length?vm.catalog:undefined);
if(query.get('experiment'))await experiments.open(query.get('experiment'));
window.addEventListener('pagehide',()=>{leaving=true;api.disposeRequests();vm.stop();experiments.dispose();});
