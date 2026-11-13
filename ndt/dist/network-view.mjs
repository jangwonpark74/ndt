import { towerHeight } from './network-data.mjs';
import { antennaPattern, sectorAzimuth, bearingSummaries } from './network-symbols.mjs?v=network-explorer-4';
import { siteLocations } from './network-model.mjs';
import { markerClass } from './network-view-model.mjs';
import { RADIO_DEFAULTS } from './radio-model.mjs';
import {openContextPanel,hideContextPanel} from './context-panel.mjs';
import {siteLabel,siteTopology} from './planning-model.mjs';
import {bindPlanningView} from './planning-view.mjs';
import {createPlanningLabels} from './planning-label-view.mjs';
import {bindEquipmentView} from './equipment-view.mjs';

export function createNetworkView({map, region, projectViewModel, viewModel:networkViewModel, projectView, inventoryReview, setLayers, getNetworkLayer, emptyFeatures}) {
const $ = id => document.getElementById(id);
let networkListSignature = null;
const labels=createPlanningLabels({map,onSelect:site=>selectNetwork(site),getSites:()=>{const s=networkViewModel.getState();return (s.features || []).filter(f=>f.properties.provider === 'Bell' ? s.bell : s.telus);},
  getSelected:()=>networkViewModel.getState().selected,getProjects:()=>region.projects,
  getProjectData:()=>projectViewModel.getState().data,getActiveProject:()=>projectViewModel.getState().selected,
  getInventoryGroups:()=>inventoryReview.groups(),getInventorySites:()=>networkViewModel.getState().features || []});
document.addEventListener('inventorygroupschange',()=>{labels.refresh();const selected=networkViewModel.getState().selected;if(selected)renderSiteDetail(selected);});
const equipment=bindEquipmentView({regionId:region.id,getProject:()=>projectViewModel.getState().selected});
bindPlanningView({regionId:region.id,getProject:()=>projectViewModel.getState().selected,getSelectedSite:()=>networkViewModel.getState().selected,getEquipmentInventory:equipment.getInventory,getRunParticipation:id=>{const s=projectViewModel.getState();return !s.data || !s.selected ? null : s.data.eligible.has(id) && (s.data.clusters.get(s.selected.id) || []).some(site=>site.properties.site_id===id);},getSiteLabel:id=>{const site=networkViewModel.getState().features?.find(s=>s.properties.site_id===id);return site?siteLabel(site):id;}});
document.addEventListener('equipmentinventorychange',()=>{const site=networkViewModel.getState().selected;if(site)renderSiteDetail(site);});
let previousProject,previousData;
projectViewModel.subscribe(state=>{
  if(state.selected === previousProject && state.data === previousData)return;
  const changedProject=state.selected !== previousProject;
  previousProject=state.selected;previousData=state.data;
  $('network-project-context').textContent=state.selected ? `${state.selected.name} · ${region.network === 'ised' ? 'Planning cluster' : 'Project'}` : `${region.name || region.id} · Select a project to plan`;
  if(changedProject)document.dispatchEvent(new CustomEvent('projectcontextchange'));
  labels.refresh();
  const selected=networkViewModel.getState().selected;
  if(selected){renderSiteDetail(selected);document.dispatchEvent(new CustomEvent('networksitechange'));}
});
document.addEventListener('reviewnetworksite',event=>selectNetwork(event.detail,true));
function syncNetworkOptions() {
  const eirp = $('coverage-eirp').value, threshold = $('coverage-threshold').value;
  networkViewModel.setOptions({telus:$('network-toggle').checked,bell:$('bell-toggle').checked,fansVisible:$('sector-fans-toggle').checked,
    focus:$('coverage-focus').checked,query:$('network-search').value,
    scenario:{mode:$('coverage-mode').value,eirpDbm:eirp === '' ? NaN : Number(eirp),thresholdDbm:threshold === '' ? NaN : Number(threshold)}});
}
function renderSectorSelection(fans) {
  const {selected:selectedNetworkFeature, sector:selectedSector} = networkViewModel.getState();
  const choices = fans.features.filter(f=>f.properties.site_id === selectedNetworkFeature?.properties.site_id);
  const chosen = choices.find(f=>f.properties.azimuth === selectedSector);
  if (!chosen && selectedSector !== null) networkViewModel.setSector(null);
  map.getSource('network-site-fans-selected')?.setData({type:'FeatureCollection',features:choices});
  map.getSource('network-sector-selected')?.setData({type:'FeatureCollection',features:chosen ? [chosen] : []});
  const panel = $('sector-selection'), buttons = $('sector-choices');
  panel.hidden = !choices.length; buttons.replaceChildren();
  if (!choices.length) return;
  $('sector-site').textContent = siteLocations(selectedNetworkFeature)[0] || 'Bell outdoor location';
  $('sector-info').textContent = chosen
    ? `Bearing ${chosen.properties.azimuth}° · ${chosen.properties.frequency_mhz} MHz · calculated ${(chosen.properties.radius_m/1000).toFixed(2)} km${chosen.properties.status === 'capped-at-5km' ? ' (5 km model limit)' : ''} · shown ${(chosen.properties.display_radius_m/1000).toFixed(2)} km · reported width ${chosen.properties.beamwidth}° (shown ${chosen.properties.display_width}°).`
    : 'Choose a bearing below, or click a colored fan on the map.';
  for (const fan of choices) {
    const button = document.createElement('button'); button.type = 'button'; button.className = `sector-choice sector-choice-${fan.properties.sector}`;
    button.textContent = `${fan.properties.azimuth}°`; button.setAttribute('aria-pressed',String(fan.properties.azimuth === selectedSector));
    button.onclick = () => { networkViewModel.setSector(fan.properties.azimuth); renderSectorSelection(fans); buttons.querySelector('[aria-pressed="true"]')?.focus(); }; buttons.append(button);
  }
}
function updateCoverage() {
  const source = map.getSource('network-sector-fans');
  if (!source) return;
  syncNetworkOptions();
  const result = networkViewModel.coverage();
  map.getSource('network-sites').setData(result.markerFeatures);
  map.getSource('network-sectors').setData(result.sectors);
  getNetworkLayer()?.setData(result.markers);
  projectView.updateProjectCoverage();
  source.setData(result.fans); renderSectorSelection(result.selectedFans); $('coverage-status').textContent = result.status;
  labels.refresh();
}
function clearNetworkSelection() {
  networkViewModel.select(null); $('network-detail').hidden = true;
  document.dispatchEvent(new CustomEvent('networksitechange'));
  map.getSource('network-selected-site')?.setData(emptyFeatures);
}
function updateFanIntensity() {
  const scale = Number($('fan-intensity').value) / 100;
  $('fan-intensity-value').textContent = `${Math.round(scale*100)}%`;
  if (!map.getLayer('network-sector-fans')) return;
  map.setPaintProperty('network-sector-fans','fill-opacity',['interpolate',['linear'],['zoom'],10,.045*scale,14,.105*scale,17,.18*scale]);
  map.setPaintProperty('network-site-fans-selected-fill','fill-opacity',.20*scale);
  map.setPaintProperty('network-sector-selected-fill','fill-opacity',.24*scale);
}
function appendTelusRecords(detail, records) {
  const group = document.createElement('details'); group.className = 'cell-records';
  const label = document.createElement('summary'); label.textContent = `Cell and antenna records (${records.length})`; group.append(label);
  for (const record of records) {
    const item = document.createElement('details'), heading = document.createElement('summary'); item.className = 'cell-record';
    heading.textContent = `${record.technology || 'Technology unknown'}${record.tx_frequency ? ` · ${record.tx_frequency} MHz` : ''} · ${record.cell_id || record.record_id || 'ID unavailable'}${record.physical_id ? ` · PCI ${record.physical_id}` : ''} · ${record.licensee}`;
    item.append(heading);
    const pattern = antennaPattern(record), azimuth = sectorAzimuth(record);
    const rxRecord = {tx_ant_omni_indicator:record.rx_ant_omni_indicator,tx_ant_azimuth:record.rx_ant_azimuth};
    const rxPattern = antennaPattern(rxRecord), rxAzimuth = sectorAzimuth(rxRecord);
    const fields = [
      ['Licensee', record.licensee], ['ISED site record ID', record.record_id], ['Reported location', record.location], ['Licence', record.licence_number],
      ['Cell ID', record.cell_id], ['Physical cell ID', record.physical_id], ['Technology', record.technology],
      ['Transmit frequency', record.tx_frequency && `${record.tx_frequency} MHz`], ['Receive frequency', record.rx_frequency && `${record.rx_frequency} MHz`],
      ['Bandwidth', record.bandwidth && `${record.bandwidth} MHz`], ['Emission class', record.class_emission], ['Downlink allocation', record.downlink_allocation],
      ['TX antenna pattern', pattern === 'omni' ? 'Non-directional' : pattern === 'directional' ? 'Directional' : 'Not specified'],
      ['TX azimuth', pattern === 'omni' ? 'Not applicable to non-directional antenna' : azimuth === null ? 'Not reported' : `${azimuth}° from true north`],
      ['TX horizontal beamwidth', record.tx_ant_horiz_beamwidth && `${record.tx_ant_horiz_beamwidth}°`], ['TX antenna height', record.tx_ant_height && `${record.tx_ant_height} m`],
      ['TX elevation angle', record.tx_ant_elevation_angle && `${record.tx_ant_elevation_angle}°`], ['TX antenna gain', record.tx_ant_gain && `${record.tx_ant_gain} dBi`],
      ['TX power', record.tx_power && `${record.tx_power} dBm`], ['TX line loss', record.tx_line_loss && `${record.tx_line_loss} dB`],
      ['TX antenna model', record.tx_ant_model_no], ['TX antenna manufacturer code', record.tx_ant_manufacturer], ['TX radio model', record.tx_radio_model_number],
      ['RX antenna pattern', rxPattern === 'omni' ? 'Non-directional' : rxPattern === 'directional' ? 'Directional' : 'Not specified'],
      ['RX azimuth', rxPattern === 'omni' ? 'Not applicable to non-directional antenna' : rxAzimuth === null ? 'Not reported' : `${rxAzimuth}° from true north`],
      ['RX horizontal beamwidth', record.rx_ant_horiz_beamwidth && `${record.rx_ant_horiz_beamwidth}°`], ['RX antenna height', record.rx_ant_height && `${record.rx_ant_height} m`],
      ['RX elevation angle', record.rx_ant_elevation_angle && `${record.rx_ant_elevation_angle}°`], ['RX antenna gain', record.rx_ant_gain && `${record.rx_ant_gain} dBi`],
      ['RX line loss', record.rx_line_loss && `${record.rx_line_loss} dB`], ['RX antenna model', record.rx_ant_model_no],
      ['RX antenna manufacturer code', record.rx_ant_manufacturer], ['RX radio model', record.rx_radio_model_number], ['Last modified', record.date_last_changed],
    ];
    const list = document.createElement('dl');
    for (const [name,value] of fields) {
      const term = document.createElement('dt'), description = document.createElement('dd');
      term.textContent = name; description.textContent = value || 'Not reported'; list.append(term,description);
    }
    item.append(list); group.append(item);
  }
  detail.append(group);
}
function appendBellBearings(detail, records) {
  const bearings = bearingSummaries(records), group = document.createElement('details'); group.className = 'cell-records';
  const label = document.createElement('summary'); label.textContent = `Reported directional bearings (${bearings.length})`; group.append(label);
  if (!bearings.length) { const note = document.createElement('p'); note.textContent = 'No valid directional TX azimuth is reported.'; group.append(note); }
  for (const bearing of bearings) {
    const item = document.createElement('details'), heading = document.createElement('summary'); item.className = 'cell-record';
    heading.textContent = `${bearing.azimuth}° from true north · ${bearing.count.toLocaleString()} records`; item.append(heading);
    const list = document.createElement('dl');
    const fields = [['Technologies', bearing.technologies.join(', ')], ['TX frequencies',bearing.frequencies.map(value=>`${value} MHz`).join(', ')], ['Reported horizontal beamwidths',bearing.beamwidths.map(value=>`${value}°`).join(', ')]];
    for (const [name,value] of fields) {
      const term = document.createElement('dt'), description = document.createElement('dd'); term.textContent = name; description.textContent = value || 'Not reported'; list.append(term,description);
    }
    item.append(list); group.append(item);
  }
  detail.append(group);
}
function renderSiteDetail(feature) {
  const detail = $('network-detail'), p = feature.properties, height = towerHeight(p.records);
  detail.replaceChildren(); detail.hidden = false;
  const title = document.createElement('h3'); title.textContent=siteLabel(feature);detail.append(title);
  const location=document.createElement('p');location.className='site-address';location.textContent=siteLocations(feature).join(' / ') || 'Location not reported';detail.append(location);
  const memberships=region.projects.filter(project=>projectViewModel.getState().data?.clusters.get(project.id)?.some(site=>site.properties.site_id === p.site_id));
  const summary=document.createElement('dl');summary.className='site-facts';
  const reviewGroups=inventoryReview.groups().filter(group=>group.siteIds.includes(p.site_id)),project=projectViewModel.getState().selected;
  const groupContext=!project?'Select a project':!inventoryReview.ready()?'Loading or unavailable':reviewGroups.length?`${project.name} / ${reviewGroups.map(c=>c.name).join(', ')}`:'None in selected project';
  const fields=[['Licensee',p.licensees.join(', ')],['Reported RATs',Object.keys(p.technologies).join(', ') || 'Not reported'],['Licensed records',p.record_count.toLocaleString()],['Tower height',height === null ? 'Not reported' : `${height} m`],['Planning projects',memberships.map(project=>project.name).join(', ') || 'Not assigned'],['Review clusters',groupContext],['Coordinates',`${feature.geometry.coordinates[1].toFixed(6)}, ${feature.geometry.coordinates[0].toFixed(6)}`]];
  for(const [name,value]of fields){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;summary.append(dt,dd);}detail.append(summary);
  const viewButton = document.createElement('button'); viewButton.className = 'network-view-site'; viewButton.type = 'button'; viewButton.textContent = 'View site in 3D';
  viewButton.onclick = () => map.flyTo({center:feature.geometry.coordinates,zoom:Math.max(map.getZoom(),16.5),pitch:60}); detail.append(viewButton);
  const topology=document.createElement('details');topology.className='site-topology';topology.open=true;
  const heading=document.createElement('summary');heading.textContent='Site topology and inventory';topology.append(heading);
  const note=document.createElement('p');note.className='network-note';note.textContent=p.provider === 'Bell' ? 'Reported bearing groups. Cell IDs, radio models and equipment connections are unavailable in this aggregate. TELUS use is unverified.' : 'Reported radio records grouped by antenna direction. Physical equipment connections are unverified.';topology.append(note);
  const label=document.createElement('label');label.textContent='Filter reported RAT ';const filter=document.createElement('select');filter.setAttribute('aria-label','Filter reported RAT');
  for(const [value,text]of [['all','All technologies'],['LTE','4G LTE'],['NR','5G NR']])filter.add(new Option(text,value));label.append(filter);topology.append(label);
  const groups=document.createElement('div');groups.className='topology-groups';topology.append(groups);
  function renderTopology(){groups.replaceChildren();const rows=siteTopology(feature,filter.value);
    if(!rows.length){const empty=document.createElement('p');empty.textContent='No reported records for this RAT.';groups.append(empty);}
    for(const row of rows){const card=document.createElement('details'),title=document.createElement('summary');card.className='topology-group';title.textContent=`${row.name} · ${row.technologies.join(', ')} · ${row.count} records`;card.append(title);
      const frequencies=[...new Set(row.records.flatMap(r=>r.frequencies || [r.tx_frequency]).filter(Boolean))];
      const info=document.createElement('p');info.textContent=`TX frequencies: ${frequencies.join(', ') || 'Not reported'} MHz`;card.append(info);
      if(p.provider === 'Bell')appendBellBearings(card,row.records);else appendTelusRecords(card,row.records);
      groups.append(card);}}
  filter.onchange=renderTopology;renderTopology();detail.append(topology);
  const link = document.createElement('a'); link.href = 'https://ised-isde.canada.ca/site/spectrum-management-system/en/spectrum-management-system-data/download-sms-data'; link.textContent = 'ISED source data'; link.target = '_blank'; link.rel = 'noopener noreferrer'; detail.append(link);
  equipment.renderSite(detail,feature);
}
function selectNetwork(feature, move = false, sector = null) {
  networkViewModel.select(feature,sector);
  document.dispatchEvent(new CustomEvent('networksitechange'));
  openContextPanel('network-panel');
  map.getSource('network-selected-site')?.setData({type:'FeatureCollection',features:[{type:'Feature',geometry:feature.geometry,properties:{}}]});
  renderSiteDetail(feature);
  $('network-browser').open=false;
  updateCoverage();
  if (move) map.flyTo({center:feature.geometry.coordinates,zoom:Math.max(map.getZoom(),16),pitch:55});
}
function refreshNetwork() {
  syncNetworkOptions();
  const bounds = map.getBounds(), result = networkViewModel.list(point=>bounds.contains(point),map.getCenter(),map.getZoom());
  if (!result) {
    if (!$('network-toggle').checked && !$('bell-toggle').checked) {
      $('network-status').textContent = 'Network layers are off. Enable TELUS sites or Bell outdoor in Network settings.';
      $('network-list-status').textContent = 'No network layers enabled'; $('network-list').replaceChildren(); networkListSignature = null;
    }
    return;
  }
  $('network-status').textContent = result.status; $('network-list-status').textContent = result.listStatus;
  const next = result.features.map(f=>f.properties.site_id).join('|');
  if (next === networkListSignature) return;
  networkListSignature = next; const list = $('network-list'); list.replaceChildren();
  for (const feature of result.features) {
    const p = feature.properties, button = document.createElement('button'); button.type = 'button';
    const category = markerClass(feature), dot = document.createElement('i'); dot.className = `network-dot ${category}`; dot.setAttribute('aria-hidden','true');
    const locationName = siteLocations(feature)[0] || `${feature.geometry.coordinates[1].toFixed(4)}, ${feature.geometry.coordinates[0].toFixed(4)}`;
    button.append(dot, document.createTextNode(`${category === 'bell' ? 'Bell outdoor' : category === 'other' ? 'TELUS other/mixed' : category === 'indoor' ? 'TELUS indoor' : 'TELUS outdoor'} · ${locationName} · ${p.record_count.toLocaleString()} records`));
    button.onclick = () => selectNetwork(feature,true); list.append(button);
  }
}
async function showNetwork() {
  const visible = $('network-toggle').checked || $('bell-toggle').checked;
  if (visible) openContextPanel('network-panel'); else hideContextPanel('network-panel');
  if (map.getLayer('network-sites')) {
    setLayers(['network-sites','network-omni-rings','network-sector-arrows','network-selected-site-ring'],visible);
    setLayers(['network-sector-fans','network-sector-outlines','network-site-fans-selected-fill','network-site-fans-selected-halo','network-site-fans-selected-line','network-sector-selected-fill','network-sector-selected-halo','network-sector-selected-line'],visible && $('sector-fans-toggle').checked);
  }
  getNetworkLayer()?.setVisible(visible);
  if (!visible) { clearNetworkSelection(); updateCoverage(); refreshNetwork(); return; }
  if (!map.getSource('network-sites')) return;
  if (!networkViewModel.getState().features) {
    $('network-status').textContent = 'Loading network records…';
    try {
      await networkViewModel.load();
    } catch (error) { $('network-status').textContent = 'Network data unavailable. Turn the layer off and on to retry.'; console.warn(error); }
  }
  if (networkViewModel.getState().features) {
    updateCoverage();
    networkListSignature = null;
  }
  refreshNetwork();
}
function click(event) {
  if ((!$('network-toggle').checked && !$('bell-toggle').checked) || !map.getLayer('network-sites')) return false;
  const hit = map.queryRenderedFeatures(event.point,{layers:['network-sector-arrows','network-sites','network-sector-fans','network-site-fans-selected-fill']})[0];
  const feature = hit && networkViewModel.getState().features?.find(f=>f.properties.site_id === hit.properties.site_id);
  if (!feature) return false;
  selectNetwork(feature,false,['network-sector-fans','network-site-fans-selected-fill'].includes(hit.layer.id) ? Number(hit.properties.azimuth) : null);
  return true;
}
$('network-toggle').onchange = () => { clearNetworkSelection(); showNetwork(); };
$('bell-toggle').onchange = () => { clearNetworkSelection(); showNetwork(); };
$('sector-fans-toggle').onchange = event => { setLayers(['network-sector-fans','network-sector-outlines','network-site-fans-selected-fill','network-site-fans-selected-halo','network-site-fans-selected-line','network-sector-selected-fill','network-sector-selected-halo','network-sector-selected-line'],event.target.checked && ($('network-toggle').checked || $('bell-toggle').checked)); updateCoverage(); };
$('coverage-focus').onchange = updateCoverage;
$('fan-intensity').oninput = updateFanIntensity;
$('network-search').oninput = () => { networkListSignature = null; refreshNetwork(); };
$('coverage-mode').value = RADIO_DEFAULTS.mode; $('coverage-eirp').value = RADIO_DEFAULTS.eirpDbm; $('coverage-threshold').value = RADIO_DEFAULTS.thresholdDbm;
for (const id of ['coverage-mode','coverage-eirp','coverage-threshold']) $(id).oninput = updateCoverage;
document.querySelector('.network-settings').addEventListener('toggle',event=>{
  if (event.target.open && ($('network-toggle').checked || $('bell-toggle').checked)) showNetwork();
});
return {showNetwork, refreshNetwork, updateFanIntensity, click};
}
