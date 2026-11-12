import {openContextPanel, showProjectOverview, hideProjectOverview} from './context-panel.mjs';
import {PROJECT_USE_CASES} from './project-data.mjs';
import {driveTestUrl} from './drive-navigation.mjs';

export function createProjectView({region, map, viewModel:projectViewModel, siteLocations, emptyFeatures, taskView, virtualUeView}) {
const $ = id => document.getElementById(id);
let projectPopup = null;
for (const id of ['project-use-case','overview-use-case']) {
  for (const item of PROJECT_USE_CASES) $(id).add(new Option(item.name,item.id));
  $(id).onchange = event => {
    const project = projectViewModel.getState().selected;
    if (project) projectViewModel.changeUseCase(project,event.target.value || null).catch(console.warn);
  };
}
projectViewModel.subscribe(state=>{
  const {selected, useCases, useCasesLoading, useCasesError, pendingUseCase, useCaseNotice} = state;
  const value = pendingUseCase && pendingUseCase.projectId === selected?.id ? pendingUseCase.value : useCases?.[selected?.id];
  const message = !selected ? 'Select a project first.' : useCasesLoading ? 'Loading use cases…' : useCasesError || (pendingUseCase?.projectId === selected.id ? 'Saving use case…' : useCaseNotice?.projectId === selected.id ? useCaseNotice.text : '');
  for (const id of ['project-use-case','overview-use-case']) {
    $(id).value = value || '';
    $(id).disabled = !selected || !useCases || !!pendingUseCase;
    $(`${id}-status`).textContent = message;
    $(`${id}-retry`).hidden = !selected || !useCasesError;
  }
});
for (const id of ['project-use-case-retry','overview-use-case-retry']) $(id).onclick = ()=>projectViewModel.loadUseCases().catch(console.warn);
function renderProjectSites() {
  const {selected, data} = projectViewModel.getState();
  $('project-sites').replaceChildren();
  for (const site of data.clusters.get(selected.id)) {
    const item = document.createElement('li'), button=document.createElement('button'); button.type='button'; button.textContent = siteLocations(site)[0] || site.properties.site_id;
    button.onclick=()=>document.dispatchEvent(new CustomEvent('reviewnetworksite',{detail:site})); item.append(button); $('project-sites').append(item);
  }
}
function updateProjectCoverage(fit = false) {
  const {selected:selectedProject, data} = projectViewModel.getState();
  if (!data || !map.getSource('project-coverage') || region.network !== 'ised') return;
  const status = $('project-status'), eirp = $('coverage-eirp').value, threshold = $('coverage-threshold').value;
  const scenario = {mode:$('coverage-mode').value,eirpDbm:eirp === '' ? NaN : Number(eirp),thresholdDbm:threshold === '' ? NaN : Number(threshold)};
  const {boundaries, sites:projectSites, boundary, status:message} = projectViewModel.coverage(scenario);
  map.getSource('project-coverage').setData({type:'FeatureCollection',features:boundaries});
  if (!selectedProject) return;
  map.getSource('project-sites').setData({type:'FeatureCollection',features:projectSites.map(site=>({type:'Feature',geometry:site.geometry,properties:{site_id:site.properties.site_id}}))});
  status.textContent = message;
  if (fit && boundary) {
    const points = boundary.geometry.coordinates[0];
    const bounds = points.reduce((result,point)=>result.extend(point),new maplibregl.LngLatBounds());
    const navigation = document.querySelector('.intro');
    // Mobile project selection closes the drawer; its closing animation must not shrink the fitted map area.
    const sidebarRight = window.innerWidth <= 700 ? 0 : navigation.getBoundingClientRect().right;
    const panel = $('context-panel').hidden ? null : $('context-panel');
    const controls = document.querySelector('.map-controls').getBoundingClientRect();
    const mobile = window.innerWidth <= 700;
    const right = mobile ? 25 : Math.max(window.innerWidth-controls.left+20,panel ? window.innerWidth-panel.getBoundingClientRect().left+25 : 30);
    const top = mobile && panel ? panel.getBoundingClientRect().bottom+16 : 100;
    map.fitBounds(bounds,{padding:{left:sidebarRight+25,right,top,bottom:mobile ? 160 : 40},pitch:0,bearing:0,maxZoom:15});
  }
}
async function selectProject(project) {
  projectPopup?.remove();
  const selection = projectViewModel.select(project,region.network === 'ised');
  $('project-picker').value = project.id;
  $('active-project').hidden = false; $('active-project').querySelector('strong').textContent = project.name;
  const overviewVisible = !$('project-overview').hidden;
  $('project-title').textContent = project.name; $('task-project-title').textContent = project.name; $('project-sites').replaceChildren();
  $('overview-open').disabled = false;
  const taskLoad=taskView.selectProject(project);
  for(const id of ['drive-workspace','overview-drive-tests'])$(id).href=driveTestUrl(region.id,project.id);
  virtualUeView.selectProject(project);
  if (!overviewVisible) openContextPanel('task-panel');
  $('project-sites-heading').hidden = region.network !== 'ised';
  if (window.innerWidth <= 700) document.querySelector('.network-settings').open = false;
  map.getSource('project-sites')?.setData(emptyFeatures);
  if (region.network !== 'ised') {
    $('project-status').textContent = 'Coverage boundary unavailable: New York reservation records have no radio bearings, widths or frequencies.';
    map.flyTo({center:project.center,zoom:project.zoom,pitch:project.pitch,bearing:0}); await taskLoad;return;
  }
  $('project-status').textContent = 'Selecting seven nearby eligible Bell locations…';
  try {
    const [accepted]=await Promise.all([selection,taskLoad]);if(!accepted)return;
    renderProjectSites();
    updateProjectCoverage(true);
  } catch (error) {
    if (projectViewModel.getState().selected === project) $('project-status').textContent = 'Project site data unavailable. Select the project again to retry.';
    console.warn(error);
  } finally {
    await taskLoad;
  }
}
function loadProjectClusters() {
  return projectViewModel.load().then(() => updateProjectCoverage());
}
function initialize() {
  projectViewModel.loadUseCases().catch(console.warn);
  if (region.network !== 'ised') return;
  loadProjectClusters().catch(error=>{
    if (!projectViewModel.getState().selected) {
      $('project-title').textContent = 'Project boundaries';
      $('project-status').textContent = 'Project site data unavailable. Select a project to retry.';
    }
    console.warn(error);
  });
}
async function changeProjectSite(project, site, add, button) {
  if (projectViewModel.getState().saving) return;
  button.disabled = true; button.textContent = 'Saving…';
  try {
    if (!await projectViewModel.changeSite(project,site,add)) return;
    if (projectViewModel.getState().selected?.id === project.id) { renderProjectSites(); updateProjectCoverage(true); }
    else updateProjectCoverage();
    if (projectPopup?.getElement()?.contains(button)) projectPopup.remove();
  } catch (error) {
    button.disabled = false; button.textContent = 'Save failed. Try again';
    if (!button.isConnected) $('project-status').textContent = `Could not save changes to ${project.name}. Select the project and try again.`;
    console.warn(error);
  }
}
function showProjectSiteMenu(event) {
  if (region.network !== 'ised' || !map.getLayer('project-site-markers')) return;
  const {selected:selectedProject, data} = projectViewModel.getState();
  if (!data) return;
  const {clusters:projectClusters, sitesById:projectSitesById, eligible:eligibleProjectSites, missing:missingProjectSites} = data;
  const hit = map.queryRenderedFeatures(event.point,{layers:['project-site-markers','network-sites']}).find(feature=>projectSitesById.has(feature.properties.site_id));
  if (!hit) return;
  event.originalEvent.preventDefault(); projectPopup?.remove();
  const site = projectSitesById.get(hit.properties.site_id), content = document.createElement('div');
  content.className = 'project-site-menu';
  const title = document.createElement('strong'); title.textContent = siteLocations(site)[0] || site.properties.site_id; content.append(title);
  const message = document.createElement('p'); content.append(message);
  if (!selectedProject) message.textContent = 'Select a project to edit its sites.';
  else if (missingProjectSites.has(selectedProject.id)) message.textContent = 'Saved project sites are missing from this dataset; editing is unavailable.';
  else {
    const project = selectedProject, member = projectClusters.get(project.id).some(item=>item.properties.site_id === site.properties.site_id);
    message.textContent = project.name;
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = member ? 'Remove site from project' : 'Add site to project';
    if (!member && !eligibleProjectSites.has(site.properties.site_id)) { button.disabled = true; message.textContent = 'This site needs three usable sector estimates.'; }
    button.onclick = () => changeProjectSite(project,site,!member,button); content.append(button);
  }
  projectPopup = new maplibregl.Popup({closeButton:true,closeOnClick:true}).setLngLat(site.geometry.coordinates).setDOMContent(content).addTo(map);
}
$('project-picker').onchange = event => {
  const project = region.projects.find(item=>item.id === event.target.value);
  if (project) selectProject(project);
};
$('active-project').onclick = showProjectOverview;
$('overview-open').onclick = showProjectOverview;
$('task-overview').onclick = showProjectOverview;
function closeOverview() {
  hideProjectOverview();
  (window.innerWidth <= 700 ? $('navigation-toggle') : $('overview-open')).focus();
}
$('overview-back').onclick = closeOverview;
$('overview-tasks').onclick = () => {openContextPanel('task-panel'); (document.getElementById('task-form').hidden ? $('task-new') : $('task-name')).focus();};
$('overview-ues').onclick = () => {openContextPanel('ue-panel'); $('ue-new').focus();};
$('project-overview').addEventListener('keydown',event => {if (event.key === 'Escape') closeOverview();});
return {initialize, selectProject, updateProjectCoverage, showProjectSiteMenu};
}
