import {ExperimentWorkspace} from './experiment-view-model.mjs';
import {$,table} from './test-view.mjs';
import {fmt} from './test-model.mjs';

const key = task => [task.region_id,task.project_id,task.task_id].join('/');

export function bindExperiments({api,clock,scope,openRun,download,onContext}) {
  const vm=new ExperimentWorkspace(api,clock,scope);
  let structure='',requestId,opened='',lastResult='';
  function render(state) {
    const task=vm.task(),current=state.experiment;
    const signature=JSON.stringify([state.catalog,state.taskKey]);
    if(signature!==structure){
      structure=signature;
      $('execution-task').replaceChildren(new Option('Choose a saved Task',''));
      for(const item of vm.tasks())$('execution-task').add(new Option(`${item.region} / ${item.project} / ${item.task_id} · ${item.task}`,key(item)));
      $('execution-task').value=state.taskKey;
      $('execution-route').replaceChildren(...(task?.routes||[]).map(r=>new Option(`${r.name} · ${r.coordinates.length} points`,r.id)));
      $('execution-route').value=state.routeId;
      $('execution-transmitter').replaceChildren(...(task?.transmitters||[]).map(t=>new Option(`${t.site_id} · ${t.frequency_mhz} MHz`,t.id)));
      $('execution-transmitter').value=state.draft.transmitter_id;
      $('execution-speeds').replaceChildren();
      for(const item of task?.speedCases||[]){
        const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=item.id;input.checked=state.caseIds.includes(item.id);
        input.onchange=()=>{requestId=null;vm.selectCases([...$('execution-speeds').querySelectorAll('input:checked')].map(i=>i.value));};
        label.append(input,document.createTextNode(`${item.speedKmh} km/h`));$('execution-speeds').append(label);
      }
      onContext(task,state.routeId);
    }
    const route=task?.routes.find(r=>r.id===state.routeId),cases=task?.speedCases.filter(c=>state.caseIds.includes(c.id))||[];
    const preview=vm.preview();
    $('execution-context').textContent=!task?'Select a saved Task, or create one in planning.':
      !route?'This Task has no saved route. Add a route in planning.':!task.transmitters.length?'Radio simulation is unavailable: this project has no eligible planning transmitters. Capture import and replay remain available.':
      `${route.name} · ${fmt(preview.distanceKm,3)} km · ${route.roadFit==='fitted'?'Legacy road fit, accuracy unverified':'Provisional path'} · ${preview.runCount} runs · about ${preview.observationCount.toLocaleString()} observations`;
    const running=current&&['queued','running'].includes(current.status);
    $('execution-submit').disabled=state.loading||state.submitting||running||!route||!cases.length||!task?.transmitters.length;
    $('execution-submit').textContent=state.submitting?'Submitting…':state.draft.experiment_type==='parameter-ab'?'Run A/B experiment':'Run virtual drive';
    $('execution-power-b').disabled=state.draft.experiment_type!=='parameter-ab';
    $('execution-refresh').disabled=state.loading||state.submitting;
    $('execution-cancel').hidden=!running;
    $('execution-error').hidden=!state.error;$('execution-error').textContent=state.error;
    $('execution-progress').textContent=current?`${current.id} · ${current.status} · ${current.progress} completed runs${current.error?' · '+current.error:''}`:'';
    $('execution-history').replaceChildren();
    for(const item of vm.history()){
      const button=document.createElement('button');button.type='button';button.textContent=`${item.id} · ${item.status} · ${item.spec.task_id}`;button.onclick=()=>vm.open(item.id);$('execution-history').append(button);
    }
    const resultSignature=current?`${current.id}/${current.status}/${current.progress}`:'';
    if(lastResult!==resultSignature){
      lastResult=resultSignature;$('execution-results').replaceChildren();
      if(current?.runs.length){
        const heading=document.createElement('h3');heading.textContent=current.status==='completed'?'Saved experiment results':'Completed member runs';$('execution-results').append(heading);
        const summary=document.createElement('p');summary.className='note';summary.textContent=`Frozen route ${current.snapshot.route.name} · ${current.spec.mode} · A ${current.spec.power_a_dbm} dBm${current.spec.experiment_type==='parameter-ab'?` · B ${current.spec.power_b_dbm} dBm at ${current.spec.transmitter_id}`:''}. Comparisons quantify this planning model.`;$('execution-results').append(summary);
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
