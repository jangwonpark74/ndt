import {ExperimentWorkspace} from './experiment-view-model.mjs';
import {$,table} from './test-view.mjs';
import {fmt} from './test-model.mjs';
import {scenarioChangeRows} from './scenario-comparison-model.mjs';

const key = task => [task.region_id,task.project_id,task.task_id].join('/');

export function bindExperiments({api,clock,scope,openRun,download,onContext}) {
  const vm=new ExperimentWorkspace(api,clock,scope);
  let structure=[],requestId,opened='',lastResult='';
  function render(state) {
    const task=vm.task(),current=state.experiment,scenario=vm.scenario(),directional=!!state.draft.scenario_id,comparing=state.draft.experiment_type==='scenario-ab',transmitters=vm.transmitters();
    const signature=[state.catalog,state.taskKey,state.draft.scenario_id,state.draft.rat,state.draft.experiment_type];
    if(signature.some((value,index)=>value!==structure[index])){
      const contextChanged=state.catalog!==structure[0] || state.taskKey!==structure[1];
      structure=signature;
      $('execution-task').replaceChildren(new Option('Choose a saved Task',''));
      for(const item of vm.tasks())$('execution-task').add(new Option(`${item.region} / ${item.project} / ${item.task_id} · ${item.task}`,key(item)));
      $('execution-task').value=state.taskKey;
      $('execution-route').replaceChildren(...(task?.routes||[]).map(r=>new Option(`${r.name} · ${r.coordinates.length} points`,r.id)));
      $('execution-route').value=state.routeId;
      const scenarios=vm.projectContext()?.scenarios || [];
      $('execution-scenario').replaceChildren(new Option('Legacy isotropic model',''),...scenarios.map(s=>new Option(`${s.name} · applied revision ${s.revision}${s.qualified?'':' · needs attention'}`,s.id)));
      if(state.draft.scenario_id && !scenario)$('execution-scenario').add(new Option('Selected applied scenario unavailable',state.draft.scenario_id));
      $('execution-transmitter').replaceChildren(...transmitters.map(t=>new Option(`${t.label || t.site_id} · ${t.rat?t.rat+' · ':''}${t.frequency_mhz} MHz`,t.id)));
      $('execution-transmitter').value=state.draft.transmitter_id;
      $('execution-speeds').replaceChildren();
      for(const item of task?.speedCases||[]){
        const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=item.id;input.checked=state.caseIds.includes(item.id);
        input.onchange=()=>{requestId=null;vm.selectCases([...$('execution-speeds').querySelectorAll('input:checked')].map(i=>i.value));};
        label.append(input,document.createTextNode(`${item.speedKmh} km/h`));$('execution-speeds').append(label);
      }
      if(contextChanged)onContext(task,state.routeId);
    }
    $('execution-scenario').value=state.draft.scenario_id;
    $('execution-transmitter').value=state.draft.transmitter_id;
    $('execution-rat').value=state.draft.rat;
    $('execution-type').value=state.draft.experiment_type;
    for(const option of $('execution-rat').options)option.disabled=directional && !vm.availableRats().includes(option.value);
    for(const [id,property]of [['execution-power-a','power_a_dbm'],['execution-power-b','power_b_dbm']])$(id).value=Number.isFinite(state.draft[property])?String(state.draft[property]):'';
    const issue=vm.scenarioIssue(),target=transmitters.find(t=>t.id===state.draft.transmitter_id),busy=state.loading || state.submitting;
    $('execution-scenario').disabled=busy || !task;
    $('execution-scenario-status').textContent=issue || (directional?`${comparing?`A baseline revision ${scenario.baselineRevision} / B applied revision ${scenario.revision} · ${state.draft.rat}`:`Applied revision ${scenario.revision} · ${transmitters.length} ${state.draft.rat} assumed transmitters · selected baseline ${fmt(target?.eirp_dbm)} dBm`}.${scenario.draftRevision>scenario.revision?` Saved revision ${scenario.draftRevision} has not been applied.`:''}`:'Legacy isotropic model; no scenario selected.');
    $('execution-model-note').textContent=comparing?'Each saved revision supplies its carrier, EIRP, pattern, orientation and environment. Route, speed cases and sampling are shared. Bandwidth is recorded; predictions remain uncalibrated planning power.':directional?'Saved templates set carrier, power, orientation, pattern and environment. Array EIRP is a peak upper bound. Imported equipment remains source evidence; predictions use study assumptions.':'Uses each site’s lowest reported usable frequency with isotropic antennas. RAT is an assumed analysis label.';
    for(const id of ['execution-power-a-field','execution-mode-field'])$(id).hidden=directional;
    for(const id of ['execution-power-a','execution-mode'])$(id).disabled=directional || busy;
    const route=task?.routes.find(r=>r.id===state.routeId),cases=task?.speedCases.filter(c=>state.caseIds.includes(c.id))||[];
    const preview=vm.preview();
    $('execution-context').textContent=!task?'Select a saved Task, or create one in planning.':
      !route?'This Task has no saved route. Add a route in planning.':!transmitters.length?(issue || 'Radio simulation is unavailable: this project has no eligible planning transmitters. Capture import and replay remain available.'):
      `${route.name} · ${fmt(preview.distanceKm,3)} km · ${route.roadFit==='fitted'?'Legacy road fit, accuracy unverified':'Provisional path'} · ${preview.runCount} runs · about ${preview.observationCount.toLocaleString()} observations`;
    const running=current&&['queued','running'].includes(current.status);
    $('execution-submit').disabled=busy||running||!route||!cases.length||!transmitters.length||!!issue;
    $('execution-submit').textContent=state.submitting?'Submitting…':comparing?'Run scenario comparison':state.draft.experiment_type==='parameter-ab'?'Run A/B experiment':'Run virtual drive';
    $('execution-power-b').disabled=state.draft.experiment_type!=='parameter-ab';
    for(const id of ['execution-power-b-field','execution-transmitter-field'])$(id).hidden=comparing;
    $('execution-transmitter').disabled=comparing || busy;
    $('execution-refresh').disabled=state.loading||state.submitting;
    $('execution-cancel').hidden=!running;
    $('execution-error').hidden=!state.error;$('execution-error').textContent=state.error;
    $('execution-progress').textContent=current?`${current.id} · ${current.status} · ${current.progress}/${current.spec.case_ids.length*(current.spec.experiment_type==='virtual-drive'?1:2)} runs${current.error?' · '+current.error:''}`:'';
    $('execution-results-state').hidden=!vm.setupDiffers();$('execution-results-state').textContent='Setup differs from the displayed run. Results retain their saved inputs; run again to use the current setup.';
    $('execution-history').replaceChildren();
    for(const item of vm.history()){
      const button=document.createElement('button');button.type='button';button.textContent=`${item.id} · ${item.status} · ${item.spec.task_id}`;button.onclick=()=>vm.open(item.id);$('execution-history').append(button);
    }
    const resultSignature=current?`${current.id}/${current.status}/${current.progress}`:'';
    if(lastResult!==resultSignature){
      lastResult=resultSignature;$('execution-results').replaceChildren();
      if(current?.runs.length){
        const heading=document.createElement('h3');heading.textContent=current.status==='completed'?'Saved experiment results':'Completed member runs';$('execution-results').append(heading);
        const frozen=current.snapshot.radioScenario;
        const summary=document.createElement('p');summary.className='note';summary.textContent=current.snapshot.radioBaseline?`Frozen route ${current.snapshot.route.name} · ${frozen.name} · A revision ${current.snapshot.radioBaseline.revision} / B revision ${frozen.revision}. Uncalibrated planning power.`:frozen?`Frozen route ${current.snapshot.route.name} · ${frozen.name || frozen.payload.name} · revision ${frozen.revision} · saved template powers and orientation${current.spec.experiment_type==='parameter-ab'?` · B changes the selected transmitter to ${current.spec.power_b_dbm} dBm`:''}. Uncalibrated planning power.`:`Frozen route ${current.snapshot.route.name} · ${current.spec.mode} · A ${current.spec.power_a_dbm} dBm${current.spec.experiment_type==='parameter-ab'?` · B ${current.spec.power_b_dbm} dBm at ${current.spec.transmitter_id}`:''}. Comparisons quantify this planning model.`;$('execution-results').append(summary);
        if(current.snapshot.scenarioChanges){const details=document.createElement('details'),title=document.createElement('summary'),changes=current.snapshot.scenarioChanges;title.textContent='Changed template inputs';details.append(title);const description=document.createElement('p');description.className='note';description.textContent=changes.length?`${changes.length} changed inputs in ${current.spec.rat} assignments${changes.length>100?' · first 100 shown; export contains all':''}.`: 'No changed inputs in the selected RAT; this is a zero-change comparison.';details.append(description);if(changes.length){const body=document.createElement('div');body.innerHTML=table(['Planning site','Input','A baseline','B applied'],scenarioChangeRows(changes.slice(0,100)));details.append(body);}$('execution-results').append(details);}
        for(const run of current.runs){
          const button=document.createElement('button');button.type='button';button.textContent=`Open ${run.variant} · ${run.speed_kmh} km/h`;
          button.onclick=()=>openRun(run.test_id,current);$('execution-results').append(button);
        }
        if(current.status==='completed'){
          const results=document.createElement('div');results.innerHTML=table(['Comparison','Paired route coverage','Median B − A'],current.comparisons.map(c=>[c.b_context.case.name,`${fmt(c.common_coverage_pct)}%`,`${fmt(c.median_delta_db)} dB`]));$('execution-results').append(results);
          const exportButton=document.createElement('button');exportButton.type='button';exportButton.textContent='Export experiment JSON';exportButton.onclick=()=>download(`${current.id}.json`,JSON.stringify(current,null,2),'application/json');$('execution-results').append(exportButton);
        }
      }
    }
    if(current?.status==='completed'&&opened!==current.id){
      opened=current.id;$('execution-details').open=false;const run=current.runs.find(r=>r.variant==='B')||current.runs[0];
      if(run)openRun(run.test_id,current);
    }
  }
  vm.subscribe(render);
  $('execution-task').onchange=event=>{requestId=null;vm.selectTask(event.target.value);};
  $('execution-scenario').onchange=event=>{requestId=null;vm.selectScenario(event.target.value);};
  $('execution-route').onchange=event=>{requestId=null;vm.selectRoute(event.target.value);onContext(vm.task(),event.target.value);};
  for(const [id,property,numeric] of [['execution-type','experiment_type'],['execution-transmitter','transmitter_id'],['execution-rat','rat'],['execution-mode','mode'],['execution-power-a','power_a_dbm',true],['execution-power-b','power_b_dbm',true],['execution-interval','interval_s',true]]){
    $(id).onchange=event=>{requestId=null;vm.edit({[property]:numeric?event.target.valueAsNumber:event.target.value});};
  }
  $('execution-form').onsubmit=event=>{event.preventDefault();requestId||=crypto.randomUUID();vm.submit(requestId);};
  $('execution-refresh').onclick=()=>{requestId=null;vm.load();};
  $('execution-cancel').onclick=()=>vm.cancel();
  $('setup-open').onclick=()=>{$('execution-details').open=true;$('execution-heading').focus();$('execution-panel').scrollIntoView({behavior:'smooth',block:'start'});};
  return vm;
}
