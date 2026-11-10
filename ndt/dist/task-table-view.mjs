import {taskSpeedCases} from './task-data.mjs';
import {driveGps,driveDistance,driveTime} from './task-format.mjs';

export function createTaskTableView({viewModel,openTask}) {
  const $ = id=>document.getElementById(id), NEW=Symbol('new');
  let editing=null,project=null,structure='',rows=new Map();
  function button(text,action) {
    const element=document.createElement('button');element.type='button';element.textContent=text;element.onclick=action;return element;
  }
  function field(label,value,type='text') {
    const input=document.createElement('input');input.type=type;input.value=value ?? '';input.setAttribute('aria-label',label);input.setAttribute('form','overview-task-form');
    return input;
  }
  function edit(id) {editing=id;structure='';viewModel.selectTask(id);}
  function cancel() {editing=null;structure='';viewModel.discard();}
  function render(state) {
    if (project!==state.projectId) {project=state.projectId;editing=null;structure='';}
    if (editing===NEW && state.originalId!==null || editing!==null && editing!==NEW && state.originalId!==editing) editing=null;
    const entries=state.tasks.map(task=>({key:task.id,task}));
    if (editing===NEW && state.draft) entries.push({key:NEW,task:state.draft});
    const busy=state.saving || Boolean(state.routing), key=`${state.projectId}|${state.tasks.map(task=>task.id).join('|')}|${editing===NEW?'new':editing}`;
    $('overview-task-new').disabled=!state.loaded || busy || state.dirty;
    $('overview-resume').hidden=!state.dirty || !state.draft || editing!==null;
    $('overview-task-retry').hidden=state.loaded || state.loading || !state.projectId;
    $('overview-task-error').hidden=!state.error;$('overview-task-error').textContent=state.error;
    $('overview-task-empty').hidden=state.loading || entries.length>0 || !state.loaded;
    if (key!==structure) {
      structure=key;rows.clear();$('overview-task-rows').replaceChildren();
      for (const entry of entries) {
        const row=document.createElement('tr');row.className='overview-task';
        const cells=Array.from({length:8},()=>{const cell=document.createElement('td');row.append(cell);return cell;});
        const details=document.createElement('tr');details.className='task-route-detail-row';details.hidden=true;
        const content=document.createElement('td');content.colSpan=8;details.append(content);
        const active=editing===entry.key, controls=[];
        const title=document.createElement('strong'),name=document.createElement('span');name.className='task-row-name';
        const inputs={};
        if (active) {
          const suffix=entry.key===NEW?'new task':entry.key;
          inputs.id=field(`Task ID for ${suffix}`,state.draft.id);inputs.id.required=true;inputs.id.maxLength=64;inputs.id.pattern='[A-Za-z0-9_-]+';
          inputs.name=field(`Task name for ${suffix}`,state.draft.name);inputs.name.required=true;inputs.name.maxLength=120;
          inputs.speedCases=field(`Drive speeds (km/h) for ${suffix}`,state.speedText);inputs.speedCases.placeholder='20, 40, 60';inputs.speedCases.maxLength=1000;
          for (const [property,input] of Object.entries(inputs)) input.oninput=()=>property==='speedCases'?viewModel.editSpeeds(input.value):viewModel.edit({[property]:input.value});
          cells[0].append(inputs.id,inputs.name);cells[1].append(inputs.speedCases);
        } else cells[0].append(title,name);
        const routeToggle=button('Routes',()=>{details.hidden=!details.hidden;routeToggle.setAttribute('aria-expanded',String(!details.hidden));});
        routeToggle.setAttribute('aria-expanded','false');cells[2].append(routeToggle);
        const editRoutes=button('Edit routes on map',()=>{const selected=active?viewModel.getState().draft:entry.task;editing=null;structure='';openTask(selected);render(viewModel.getState());});content.append(editRoutes);
        const routeList=document.createElement('div');routeList.className='task-route-data';content.append(routeList);
        if (active) {
          const save=document.createElement('button');save.type='submit';save.setAttribute('form','overview-task-form');save.textContent='Save';save.className='task-primary';
          const discard=button('Cancel',cancel);cells[7].append(save,discard);controls.push(save,discard);
        } else {
          const change=button('Edit task',()=>edit(entry.key));
          const remove=button('Delete task',async()=>{if (!confirm(`Delete task ${entry.task.id} and its routes?`)) return;viewModel.selectTask(entry.key);await viewModel.save(true);});
          remove.className='task-danger';cells[7].append(change,remove);controls.push(change,remove);
        }
        rows.set(entry.key,{row,cells,title,name,inputs,controls,routeToggle,details,routeList,editRoutes,active});
        $('overview-task-rows').append(row,details);
      }
    }
    for (const entry of entries) {
      const record=rows.get(entry.key),task=record.active?state.draft:entry.task;
      if (!task) continue;
      const metrics=record.active?viewModel.driveMetrics():viewModel.driveMetrics(task);
      record.title.textContent=task.id;record.name.textContent=task.name;
      for (const [property,input] of Object.entries(record.inputs)) {const value=property==='speedCases'?state.speedText:task[property]==null?'':String(task[property]);if(input.value!==value)input.value=value;input.disabled=busy;if(property==='speedCases')input.setCustomValidity(state.speedError);}
      if (!record.active) record.cells[1].textContent=taskSpeedCases(task).length?taskSpeedCases(task).map(item=>item.speedKmh).join(', ')+' km/h':'Not set';
      record.routeToggle.textContent=`${task.routes.length} ${task.routes.length===1?'route':'routes'}`;
      record.cells[3].textContent=driveDistance(metrics.distanceKm);record.cells[3].dataset.metric='distance';
      record.cells[4].textContent=driveTime(metrics);record.cells[4].dataset.metric='duration';
      record.cells[5].textContent=driveGps(metrics.start);record.cells[5].dataset.metric='start';
      record.cells[6].textContent=driveGps(metrics.end);record.cells[6].dataset.metric='end';
      record.row.dataset.provisional=String(metrics.provisional);record.cells[3].title=metrics.provisional?'Provisional: contains paths not fitted to roads':'Route geometry distance';
      for (const control of record.controls) control.disabled=busy || (!record.active && state.dirty);
      record.editRoutes.disabled=busy || (state.dirty && !record.active);
      record.routeList.replaceChildren();
      if ((metrics.speedCases || []).length>1) {
        const heading=document.createElement('h3');heading.textContent='Speed cases · shared routes';record.routeList.append(heading);
        for (const item of metrics.speedCases) {const line=document.createElement('p'),label=document.createElement('strong'),value=document.createElement('span');label.textContent=`${item.id} · ${item.name}`;value.textContent=`${item.speedKmh} km/h · ${driveTime(item)}`;value.dataset.speedCase=item.id;line.append(label,value);record.routeList.append(line);}
      }
      for (const route of task.routes) {
        const raw=metrics.routes.find(item=>item.id===route.id),value={...raw,speedCases:(metrics.speedCases || []).map(item=>({...item,durationSeconds:item.routes.find(entry=>entry.id===route.id)?.durationSeconds ?? null}))},line=document.createElement('p'),label=document.createElement('strong');label.textContent=`${route.id} · ${route.name}`;
        const text=document.createElement('span');text.textContent=`${route.roadFit==='fitted'?'Road fitted':'Not fitted'} · ${route.coordinates.length} path points · ${driveDistance(value.distanceKm)} · ${driveTime(value)} · Start ${driveGps(value.start)} → End ${driveGps(value.end)}`;
        if(value.speedCases.length>1)text.textContent+=' · By speed: '+value.speedCases.map(item=>`${item.speedKmh} km/h: ${driveTime({...item,distanceKm:value.distanceKm})}`).join('; ');
        line.append(label,text);record.routeList.append(line);
      }
    }
  }
  $('overview-task-new').onclick=()=>{editing=NEW;structure='';viewModel.newTask();rows.get(NEW)?.inputs.name.focus();};
  $('overview-resume').onclick=()=>{const state=viewModel.getState();editing=state.originalId??NEW;structure='';render(state);};
  $('overview-task-retry').onclick=()=>viewModel.selectProject(viewModel.getState().projectId);
  $('overview-task-form').onsubmit=async event=>{event.preventDefault();if(await viewModel.save()){editing=null;structure='';render(viewModel.getState());}};
  viewModel.subscribe(render);
}
