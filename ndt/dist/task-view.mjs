import {createTaskTableView} from './task-table-view.mjs';
import {driveDuration as duration,driveGps,driveTime} from './task-format.mjs';
import {openContextPanel} from './context-panel.mjs';
import {driveTestUrl} from './drive-navigation.mjs';

export function createTaskView({map,viewModel,regionId}) {
  const $ = id => document.getElementById(id);
  let project = null, markers = [];
  function button(label, action, className = '') {
    const item = document.createElement('button'); item.type = 'button'; item.textContent = label; item.className = className; item.onclick = action; return item;
  }
  function metricsElement(metrics) {
    const element = document.createElement('dl'); element.className = 'drive-metrics';
    const gps = driveGps;
    const rows = [
      ['distance','Driving distance',metrics.distanceKm === null ? 'Add a route' : `${metrics.distanceKm.toFixed(3)} km`],
      ['duration','Estimated driving duration',driveTime(metrics)],
      ['start','Start GPS (WGS84)',gps(metrics.start)],['end','End GPS (WGS84)',gps(metrics.end)],
    ];
    for (const [key,label,value] of rows) {
      const term = document.createElement('dt'); term.textContent = label;
      const description = document.createElement('dd'); description.dataset.metric = key; description.textContent = value;
      element.append(term,description);
    }
    return element;
  }
  function caseResults(cases) {
    const list=document.createElement('dl');list.className='drive-metrics speed-case-results';
    for (const item of cases) {const label=document.createElement('dt'),value=document.createElement('dd');label.textContent=`${item.id} · ${item.speedKmh} km/h`;value.textContent=item.durationSeconds===null?'Add a route':duration(item.durationSeconds);value.dataset.speedCase=item.id;list.append(label,value);}
    return list;
  }
  function fit(coordinates) {
    if (!coordinates.length) return;
    const bounds = coordinates.reduce((result,point)=>result.extend(point),new maplibregl.LngLatBounds());
    const mobile = window.innerWidth <= 700, panel = $('context-panel').getBoundingClientRect();
    map.fitBounds(bounds,{padding:{left:mobile ? 24 : 224,right:mobile ? 24 : window.innerWidth-panel.left+24,top:mobile ? panel.bottom+40 : 100,bottom:mobile ? 120 : 40},pitch:0,bearing:0,maxZoom:16});
  }
  function drawMap() {
    const collection = viewModel.features();
    map.getSource('task-routes')?.setData(collection);
    for (const marker of markers) marker.remove(); markers = [];
    if (!map.getSource('task-routes')) return;
    const labels = new Map();
    for (const feature of collection.features.filter(feature=>feature.geometry.type === 'Point')) {
      const key = JSON.stringify(feature.geometry.coordinates), existing = labels.get(key);
      if (existing) {
        if (!existing.textContent.includes(feature.properties.kind)) existing.textContent = 'Start / End';
        existing.title += ` · ${feature.properties.name}: ${feature.properties.kind}`;
        continue;
      }
      const element = document.createElement('span'); element.className = `route-endpoint route-${feature.properties.kind.toLowerCase()}`;
      element.textContent = feature.properties.kind; element.title = `${feature.properties.name}: ${feature.properties.kind}`;
      labels.set(key,element);
      markers.push(new maplibregl.Marker({element,anchor:'bottom',offset:[0,-9]}).setLngLat(feature.geometry.coordinates).addTo(map));
    }
    map.getCanvas().classList.toggle('route-drawing',Boolean(viewModel.getState().drawing));
  }
  function render(state) {
    for(const id of ['drive-workspace','overview-drive-tests']){
      const link=$(id),disabled=!state.projectId||state.dirty||state.loading||state.saving;
      link.setAttribute('aria-disabled',String(disabled));link.tabIndex=disabled?-1:0;
      link.onclick=event=>{if(disabled)event.preventDefault();};
      link.title=disabled?'Save or discard Task changes before opening drive tests.':'Open drive tests for this project';
    }
    const {tasks,draft,originalId,dirty,loading,saving,error,drawing,loaded,routing} = state;
    const busy = saving || Boolean(routing);
    $('road-fit-progress').hidden = !routing;
    $('road-fit-status').textContent = routing ? `Fitting route ${routing.index} of ${routing.total}: ${routing.name}…` : '';
    $('task-status').textContent = loading ? 'Loading tasks…' : !loaded ? error || 'Select a project to manage tasks.' : `${tasks.length} saved ${tasks.length === 1 ? 'task' : 'tasks'} · ${dirty ? 'Unsaved draft' : 'Changes saved to this project'}`;
    $('tasks-retry').hidden = loaded || loading || !project;
    $('task-new').disabled = !loaded || busy || dirty;
    $('task-list').replaceChildren();
    $('overview-task-status').textContent = loading ? 'Loading tasks…' : !loaded ? error : `${tasks.length} saved ${tasks.length === 1 ? 'task' : 'tasks'}${dirty ? ' · Unsaved draft in Tasks' : ''}`;
    if (loaded && !tasks.length) $('overview-task-status').textContent += ' · Create a task to plan your first drive test.';
    for (const task of tasks) {
      const choose = () => {viewModel.selectTask(task.id); openContextPanel('task-panel'); fit(task.routes.flatMap(route=>route.coordinates));};
      const item = button(`${task.id} · ${task.name}`,choose,'task-list-item'); item.setAttribute('aria-pressed',String(originalId === task.id)); item.disabled = busy || dirty; $('task-list').append(item);
    }
    $('task-form').hidden = !draft;
    $('task-save-state').textContent = routing ? 'Fitting roads…' : saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved';
    $('task-error').hidden = !error; $('task-error').textContent = error;
    if (draft) {
      for (const field of ['id','name']) { if ($(`task-${field}`).value !== draft[field]) $(`task-${field}`).value = draft[field]; $(`task-${field}`).disabled = busy || Boolean(drawing); }
      const speed = state.speedText;
      if ($('task-speed').value !== speed) $('task-speed').value = speed;
      $('task-speed').disabled = busy || Boolean(drawing);$('task-speed').setCustomValidity(state.speedError);
      const metrics = viewModel.driveMetrics();
      $('task-drive-metrics').replaceChildren(metricsElement(metrics));
      $('task-drive-quality').hidden = !metrics.provisional;
      $('task-speed-results').replaceChildren();$('task-speed-results').hidden=metrics.speedCases.length<2;
      if (metrics.speedCases.length>1) $('task-speed-results').append(caseResults(metrics.speedCases));
      $('task-routes').replaceChildren();
      for (const route of draft.routes) {
        const item = document.createElement('div'); item.className = 'route-card';
        const title = document.createElement('strong'); title.textContent = route.name;
        const status = document.createElement('p'); status.className = 'route-fit-status';
        status.textContent = route.fitMessage || (route.roadFit === 'fitted' ? 'Road fitted' : 'Not road fitted · original path');
        status.dataset.fitted = String(route.roadFit === 'fitted');
        const details = document.createElement('details'); details.className = 'route-drive-details';
        const summary = document.createElement('summary'); summary.textContent = 'Distance, duration & GPS';
        const routeMetrics=metrics.routes.find(item=>item.id === route.id);details.append(summary,metricsElement(routeMetrics));
        if (routeMetrics.speedCases.length>1) details.append(caseResults(routeMetrics.speedCases));
        const show = button('View route',()=>fit(route.coordinates));
        const remove = button('Remove route',()=>viewModel.removeRoute(route.id)); remove.disabled = busy || Boolean(drawing);
        const fitRoads = button('Fit to roads',()=>viewModel.fitRoute(route.id)); fitRoads.disabled = busy || Boolean(drawing);
        const drive=button('Open drive tests',()=>{location.href=driveTestUrl(regionId,state.projectId,state.originalId,route.id);});
        drive.disabled=dirty||busy||!state.originalId||Boolean(drawing);drive.title=drive.disabled?'Save the Task first':'Use this saved route in the drive-test workspace';
        item.append(title,status,details,show,fitRoads,remove,drive); $('task-routes').append(item);
      }
    }
    $('task-save').disabled = !dirty || busy || Boolean(drawing);
    $('task-discard').disabled = !dirty || saving;
    $('task-delete').hidden = !originalId; $('task-delete').disabled = busy || Boolean(drawing);
    $('route-draw').disabled = busy || Boolean(drawing); $('route-import').disabled = busy || Boolean(drawing); $('route-name').disabled = busy || Boolean(drawing);
    $('route-drawing').hidden = !drawing;
    if (drawing) {
      $('route-draw-status').textContent = `${drawing.coordinates.length} waypoints · Click the map to add a point. Finish to follow roads from Start → End. Escape cancels.`;
      $('route-finish').disabled = drawing.coordinates.length < 2; $('route-undo').disabled = !drawing.coordinates.length;
    }
    drawMap();
  }
  createTaskTableView({viewModel,driveTestUrl:taskId=>driveTestUrl(regionId,viewModel.getState().projectId,taskId),openTask:task=>{
    if (!viewModel.getState().dirty) viewModel.selectTask(task.id);
    openContextPanel('task-panel'); $('task-name').focus();
    fit(task.routes.flatMap(route=>route.coordinates));
  }});
  viewModel.subscribe(render);
  $('task-new').onclick = () => {viewModel.newTask(); $('task-name').focus();};
  for (const field of ['id','name']) $(`task-${field}`).oninput = event => viewModel.edit({[field]:event.target.value});
  $('task-speed').oninput = event => viewModel.editSpeeds(event.target.value);
  $('task-form').onsubmit = event => {event.preventDefault(); viewModel.save();};
  $('task-discard').onclick = () => viewModel.discard();
  $('task-delete').onclick = () => {if (confirm(`Delete task ${viewModel.getState().originalId} and its routes?`)) viewModel.save(true);};
  $('tasks-retry').onclick = () => viewModel.selectProject(project.id);
  $('route-draw').onclick = () => {viewModel.beginDraw($('route-name').value); map.getCanvas().focus();};
  $('route-undo').onclick = () => viewModel.undoPoint();
  $('route-cancel').onclick = () => viewModel.cancelDraw();
  $('route-finish').onclick = () => viewModel.finishDraw();
  $('road-fit-cancel').onclick = () => viewModel.cancelFit();
  $('route-import').onchange = async event => {
    const file = event.target.files[0], selected = viewModel.getState(); event.target.value = '';
    if (!file) return;
    if (file.size > 2000000) return viewModel.reportError('Import a GeoJSON file smaller than 2 MB.');
    try {
      const content = await file.text();
      const current = viewModel.getState();
      if (current.projectId !== selected.projectId || current.draft !== selected.draft) return;
      viewModel.import(JSON.parse(content));
    } catch { viewModel.reportError('The file could not be read as GeoJSON. Your existing routes are unchanged.'); }
  };
  document.addEventListener('keydown',event=>{if (event.key === 'Escape' && viewModel.getState().drawing) {event.stopImmediatePropagation(); viewModel.cancelDraw(); $('route-draw').focus();}},true);
  document.addEventListener('contextchange',event=>{if (event.detail !== 'task-panel' && viewModel.getState().drawing) viewModel.cancelDraw();});
  return {
    selectTask(id) {viewModel.selectTask(id);},
    selectProject(value) { project = value; return viewModel.selectProject(value.id); },
    click(event) {return viewModel.addPoint([event.lngLat.lng,event.lngLat.lat]);},
    initialize() {
      map.addSource('task-routes',{type:'geojson',data:viewModel.features()});
      map.addLayer({id:'task-route-halo',type:'line',source:'task-routes',filter:['==',['get','kind'],'route'],paint:{'line-color':'#ffffff','line-width':8}});
      map.addLayer({id:'task-route-line',type:'line',source:'task-routes',filter:['all',['==',['get','kind'],'route'],['==',['get','road_fitted'],true]],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#176d86','line-width':4}});
      map.addLayer({id:'task-route-unmatched',type:'line',source:'task-routes',filter:['all',['==',['get','kind'],'route'],['==',['get','road_fitted'],false]],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#996c26','line-width':4,'line-dasharray':[2,2]}});
      map.addLayer({id:'task-route-points',type:'circle',source:'task-routes',filter:['!=',['get','kind'],'route'],paint:{'circle-color':['match',['get','kind'],'Start','#135a43','#6d4a8a'],'circle-radius':7,'circle-stroke-width':2,'circle-stroke-color':'#ffffff'}});
      drawMap();
    },
  };
}
