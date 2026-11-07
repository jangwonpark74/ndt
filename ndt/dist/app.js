import * as THREE from 'three';
import { layerGroups, featureDetails } from './map-data.mjs';
import { createRoofLayer } from './roof-layer.mjs';
import { createTreeLayer } from './tree-layer.mjs';
import { lightPresets, mapLight } from './lighting.mjs';
import { shadowFeatures } from './shadows.mjs';
import { createStreetDetailLayer } from './street-detail.mjs';
import { searchResults } from './search.mjs';
import { createNetworkLayer, siteClass, towerHeight, validTelusSite, validBellOutdoorSite } from './network-layer.mjs';
import { antennaPattern, sitePattern, sectorAzimuth, sectorFeatures, sectorFanFeatures, bearingSummaries, siteMatchesQuery } from './network-symbols.mjs?v=network-explorer-2';
import { RADIO_DEFAULTS } from './radio-model.mjs';

const $ = id => document.getElementById(id);
function reportLayerStatus(id, control, text) {
  const status = $(id), unavailable = text.includes('unavailable');
  status.textContent = unavailable ? `${text} Turn ${control} off and on to retry.` : text;
  status.hidden = !unavailable;
}
const CITY = { center: [-79.39, 43.70], zoom: 10.2, pitch: 43, bearing: 0 };
const HARBOURFRONT = { center: [-79.3922155, 43.6394193], zoom: 17, pitch: 58, bearing: 0 };
const DISTRICTS = { etobicoke: [-79.56, 43.65], northyork: [-79.412, 43.769], scarborough: [-79.25, 43.78] };
const map = new maplibregl.Map({
  container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty',
  ...CITY, maxPitch: 75, attributionControl: false,
});
map.addControl(new maplibregl.AttributionControl({compact: false}), 'bottom-right');
let markerLayer, roofLayer, treeLayer, streetDetailLayer, networkLayer;
let streetLayers = [];
let buildingLayers = [];
let terrainReady = false;
let terrainTileError = false;
let loadFinished = false;
let terrainWarning;
const lighting = lightPresets.southeast;
const emptyFeatures = {type:'FeatureCollection', features:[]};
let shadowSignature = '';
let networkFeatures = null, networkLoading = false, networkListSignature = null, selectedNetworkFeature = null, selectedSector = null;
function activeNetworkFeatures() {
  return (networkFeatures || []).filter(feature => feature.properties.provider === 'Bell' ? $('bell-toggle').checked : $('network-toggle').checked);
}
function markerClass(feature) { return feature.properties.provider === 'Bell' ? 'bell' : siteClass(feature.properties.records); }
function renderSectorSelection(fans) {
  const choices = fans.features.filter(f=>f.properties.site_id === selectedNetworkFeature?.properties.site_id);
  const chosen = choices.find(f=>f.properties.azimuth === selectedSector);
  if (!chosen) selectedSector = null;
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
    button.onclick = () => { selectedSector = fan.properties.azimuth; renderSectorSelection(fans); buttons.querySelector('[aria-pressed="true"]')?.focus(); }; buttons.append(button);
  }
}
function updateCoverage() {
  const source = map.getSource('network-sector-fans');
  if (!source) return;
  const status = $('coverage-status');
  if (!$('sector-fans-toggle').checked) { source.setData(emptyFeatures); renderSectorSelection(emptyFeatures); status.textContent = 'Planning estimate is off.'; return; }
  if (!$('bell-toggle').checked) { source.setData(emptyFeatures); renderSectorSelection(emptyFeatures); status.textContent = 'Enable Bell outdoor to see planning estimates.'; return; }
  if (!networkFeatures) { source.setData(emptyFeatures); renderSectorSelection(emptyFeatures); status.textContent = 'Loading network records…'; return; }
  const eirp = $('coverage-eirp').value, threshold = $('coverage-threshold').value;
  const scenario = {mode:$('coverage-mode').value,eirpDbm:eirp === '' ? NaN : Number(eirp),thresholdDbm:threshold === '' ? NaN : Number(threshold)};
  if (!Number.isFinite(scenario.eirpDbm) || scenario.eirpDbm < 0 || scenario.eirpDbm > 90 || !Number.isFinite(scenario.thresholdDbm) || scenario.thresholdDbm < -160 || scenario.thresholdDbm > -20) {
    source.setData(emptyFeatures); renderSectorSelection(emptyFeatures); status.textContent = 'Enter EIRP 0–90 dBm and received-power threshold −160 to −20 dBm.'; return;
  }
  const allFans = sectorFanFeatures(activeNetworkFeatures(),scenario);
  const selected = selectedNetworkFeature?.properties.provider === 'Bell'
    ? sectorFanFeatures([selectedNetworkFeature],scenario,{includeOtherBearingCounts:true}) : emptyFeatures;
  const fans = $('coverage-focus').checked ? selected : allFans;
  source.setData(fans); renderSectorSelection(selected);
  if ($('coverage-focus').checked && !selectedNetworkFeature) { status.textContent = 'Select a Bell outdoor site to focus its fans.'; return; }
  if (!fans.features.length) { status.textContent = 'No estimates: usable bearings, frequencies and beamwidths and a link budget reaching at least 10 m are required.'; return; }
  const count = new Set(fans.features.map(f=>f.properties.site_id)).size;
  status.textContent = `${fans.features.length.toLocaleString()} bearing estimates at ${count.toLocaleString()} Bell locations · fans drawn at 5/12 of calculated radius.${selected.features.length ? ` Selected: ${selected.features.map(f=>`${f.properties.azimuth}°: ${(f.properties.radius_m/1000).toFixed(2)} km calculated, ${(f.properties.display_radius_m/1000).toFixed(2)} km shown at ${f.properties.frequency_mhz} MHz${f.properties.status === 'capped-at-5km' ? ' (5 km model limit)' : ''}`).join(' · ')}.` : ''}`;
}
function siteLocations(feature) {
  return [...new Set((feature.properties.locations || feature.properties.records.map(record=>record.location)).filter(value=>typeof value === 'string' && value.trim()).map(value=>value.trim()))];
}
function clearNetworkSelection() {
  selectedNetworkFeature = null; selectedSector = null; $('network-detail').hidden = true;
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
function selectNetwork(feature, move = false, sector = null) {
  selectedNetworkFeature = feature;
  selectedSector = sector;
  map.getSource('network-selected-site')?.setData({type:'FeatureCollection',features:[{type:'Feature',geometry:feature.geometry,properties:{}}]});
  const detail = $('network-detail'), p = feature.properties, height = towerHeight(p.records);
  detail.replaceChildren(); detail.hidden = false;
  const title = document.createElement('strong'); title.textContent = `${p.provider === 'Bell' ? 'Bell Mobility' : 'TELUS'} · ${p.record_count.toLocaleString()} licensed records`; detail.append(title);
  const viewButton = document.createElement('button'); viewButton.className = 'network-view-site'; viewButton.type = 'button'; viewButton.textContent = 'View site in 3D';
  viewButton.onclick = () => map.flyTo({center:feature.geometry.coordinates,zoom:Math.max(map.getZoom(),16.5),pitch:60}); detail.append(viewButton);
  const description = document.createElement('div');
  const siteTypes = [...new Set(p.records.map(record => ({I:'Indoor',O:'Outdoor',U:'Underground'}[record.site_type] || 'Unknown')))];
  const antennaHeights = [...new Set(p.records.map(record=>record.tx_ant_height).filter(value=>value !== ''))];
  description.textContent = `${Object.entries(p.technologies).map(([name,count])=>`${name}: ${count}`).join(' · ')} · ISED site: ${siteTypes.join(', ')} · ${height !== null ? `Reported tower height: ${height} m` : 'Tower height unavailable'}${antennaHeights.length === 1 ? ` · Reported TX antenna height: ${antennaHeights[0]} m` : ''} · ${p.licensees.join(', ')}`;
  detail.append(description);
  const location = document.createElement('div'); location.className = 'site-location';
  const names = siteLocations(feature), ids = p.ised_site_ids || [...new Set(p.records.map(record=>record.record_id).filter(Boolean))];
  location.textContent = `ISED location: ${names.length ? names.join(' / ') : 'Not reported'} · Coordinates: ${feature.geometry.coordinates[1].toFixed(6)}, ${feature.geometry.coordinates[0].toFixed(6)}${ids.length ? ` · Site IDs: ${ids.join(', ')}` : ''}`;
  detail.append(location);
  if (p.provider === 'Bell') { const note = document.createElement('div'); note.textContent = 'Bell-licensed location; TELUS use of this individual site is not confirmed.'; detail.append(note); }
  const link = document.createElement('a'); link.href = 'https://ised-isde.canada.ca/site/spectrum-management-system/en/spectrum-management-system-data/download-sms-data'; link.textContent = 'ISED source data'; link.target = '_blank'; link.rel = 'noopener noreferrer'; detail.append(link);
  if (p.provider === 'Bell') appendBellBearings(detail,p.records); else appendTelusRecords(detail,p.records);
  updateCoverage();
  if (move) map.flyTo({center:feature.geometry.coordinates,zoom:Math.max(map.getZoom(),16),pitch:55});
}
function refreshNetwork() {
  if ((!$('network-toggle').checked && !$('bell-toggle').checked) || !networkFeatures) return;
  const bounds = map.getBounds(), center = map.getCenter();
  const active = activeNetworkFeatures(), inView = active.filter(feature => bounds.contains(feature.geometry.coordinates));
  const query = $('network-search').value.trim();
  const features = query ? active.filter(feature=>siteMatchesQuery(feature,query)) : inView;
  features.sort((a,b) => {
    const distance = f => Math.hypot((f.geometry.coordinates[0]-center.lng)*Math.cos(center.lat*Math.PI/180),f.geometry.coordinates[1]-center.lat);
    return distance(a)-distance(b);
  });
  const towers = inView.filter(feature=>towerHeight(feature.properties.records) !== null).length;
  const telus = inView.filter(feature=>feature.properties.provider !== 'Bell').length, bell = inView.length-telus;
  $('network-status').textContent = `In view: ${telus} TELUS coordinates · ${bell} Bell outdoor coordinates · ${towers} towers with reported height${map.getZoom() < 14 ? ' · Zoom in for directional symbols' : ''}`;
  $('network-list-status').textContent = query ? `${features.length.toLocaleString()} matching locations${features.length > 8 ? ' · showing nearest 8' : ''}` : `Nearby locations${features.length > 8 ? ' · showing nearest 8' : ''}`;
  const next = features.slice(0,8).map(f=>f.properties.site_id).join('|');
  if (next === networkListSignature) return;
  networkListSignature = next; const list = $('network-list'); list.replaceChildren();
  for (const feature of features.slice(0,8)) {
    const p = feature.properties, button = document.createElement('button'); button.type = 'button';
    const category = markerClass(feature), dot = document.createElement('i'); dot.className = `network-dot ${category}`; dot.setAttribute('aria-hidden','true');
    const locationName = siteLocations(feature)[0] || `${feature.geometry.coordinates[1].toFixed(4)}, ${feature.geometry.coordinates[0].toFixed(4)}`;
    button.append(dot, document.createTextNode(`${category === 'bell' ? 'Bell outdoor' : category === 'other' ? 'TELUS other/mixed' : category === 'indoor' ? 'TELUS indoor' : 'TELUS outdoor'} · ${locationName} · ${p.record_count.toLocaleString()} records`));
    button.onclick = () => selectNetwork(feature,true); list.append(button);
  }
}
async function showNetwork() {
  const visible = $('network-toggle').checked || $('bell-toggle').checked;
  $('network-panel').hidden = !visible;
  if (map.getLayer('network-sites')) {
    setLayers(['network-sites','network-omni-rings','network-sector-arrows','network-selected-site-ring'],visible);
    setLayers(['network-sector-fans','network-sector-outlines','network-site-fans-selected-fill','network-site-fans-selected-halo','network-site-fans-selected-line','network-sector-selected-fill','network-sector-selected-halo','network-sector-selected-line'],visible && $('sector-fans-toggle').checked);
  }
  networkLayer?.setVisible(visible);
  if (!visible) { clearNetworkSelection(); updateCoverage(); return; }
  if (!map.getSource('network-sites')) return;
  if (!networkFeatures && !networkLoading) {
    networkLoading = true; $('network-status').textContent = 'Loading network records…';
    try {
      const responses = await Promise.all(['./telus-sites.geojson','./bell-outdoor-sites.geojson?v=3gpp-preview-1'].map(url=>fetch(url)));
      if (responses.some(response=>!response.ok)) throw new Error('Network data request failed');
      const datasets = await Promise.all(responses.map(response=>response.json()));
      for (const [index,data] of datasets.entries()) {
        const valid = index ? validBellOutdoorSite : validTelusSite;
        if (data.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.every(valid) ||
            data.features.reduce((sum,f)=>sum+f.properties.record_count,0) !== data.record_count ||
            new Set(data.features.map(f=>f.properties.site_id)).size !== data.features.length) throw new Error('Invalid network site data');
      }
      networkFeatures = datasets.flatMap(data=>data.features);
    } catch (error) { $('network-status').textContent = 'Network data unavailable. Turn the layer off and on to retry.'; console.warn(error); }
    finally { networkLoading = false; }
  }
  if (networkFeatures) {
    const active = activeNetworkFeatures();
    map.getSource('network-sites').setData({type:'FeatureCollection',features:active.map(feature=>({type:'Feature',geometry:feature.geometry,properties:{site_id:feature.properties.site_id,site_class:markerClass(feature),antenna_pattern:feature.properties.provider === 'Bell' ? 'unknown' : sitePattern(feature.properties.records)}}))});
    map.getSource('network-sectors').setData(sectorFeatures(active));
    updateCoverage();
    networkLayer.setData(active); networkListSignature = null;
  }
  refreshNetwork();
}
function refreshShadows() {
  const source = map.getSource('building-shadows');
  if (!source) return;
  if (!$('shadows-toggle').checked || !$('buildings-toggle').checked || map.getZoom() < 15) {
    $('shadow-status').textContent = $('shadows-toggle').checked ? 'Zoom in with buildings on to see shadows.' : 'Lighting, shadows and street models are illustrative.';
    if (shadowSignature) { shadowSignature = ''; source.setData(emptyFeatures); }
    return;
  }
  const data = shadowFeatures(map.querySourceFeatures('openmaptiles', {sourceLayer:'building'}), 1500, lighting.direction);
  $('shadow-status').textContent = data.features.length ? 'Lighting, shadows and street models are illustrative.' : 'No building shadows available in this view.';
  const signature = JSON.stringify(data);
  if (signature !== shadowSignature) { shadowSignature = signature; source.setData(data); }
}

// MapLibre draws the base map and terrain; Three.js shares its camera and WebGL context for scene details.
function createMarkerLayer() {
  let renderer, camera, scene, marker;
  let location = null, featureHeight = 0;
  return {
    id: 'three-selection', type: 'custom', renderingMode: '3d',
    onAdd(mapInstance, gl) {
      camera = new THREE.Camera(); scene = new THREE.Scene();
      marker = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 35, 12), new THREE.MeshBasicMaterial({color: 0x365c40}));
      pole.rotation.x = Math.PI / 2; pole.position.z = 17.5;
      const top = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 12), new THREE.MeshBasicMaterial({color: 0xb4ee65}));
      top.position.z = 36; marker.add(pole, top); marker.visible = false; scene.add(marker);
      renderer = new THREE.WebGLRenderer({canvas: mapInstance.getCanvas(), context: gl, antialias: true});
      renderer.autoClear = false;
    },
    setLocation(value, height = 0) { location = value; featureHeight = height; if (marker) marker.visible = Boolean(value); map.triggerRepaint(); },
    render(gl, args) {
      if (!location || !renderer) return;
      const elevation = map.getTerrain() ? map.queryTerrainElevation(location) : 0;
      const origin = maplibregl.MercatorCoordinate.fromLngLat(location, (Number.isFinite(elevation) ? elevation : 0) + featureHeight);
      const unit = origin.meterInMercatorCoordinateUnits();
      const transform = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z).scale(new THREE.Vector3(unit, unit, unit));
      camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(transform);
      renderer.resetState(); renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); renderer.render(scene, camera);
    },
    onRemove() { renderer?.dispose(); }
  };
}

function terrainStatus() {
  const status = $('terrain-status');
  if (!map.getTerrain()) {
    terrainReady = false; terrainTileError = false; clearTimeout(terrainWarning); terrainWarning = null;
    status.textContent = 'Terrain is off.'; status.hidden = true; return;
  }
  if (terrainTileError) return;
  const elevation = map.queryTerrainElevation(map.getCenter());
  if (Number.isFinite(elevation)) {
    terrainReady = true; clearTimeout(terrainWarning); terrainWarning = null;
    status.textContent = `Terrain elevation near map center: ${Math.round(elevation)} m.`; status.hidden = true;
  } else {
    terrainReady = false;
    if (status.hidden) {
      status.textContent = 'Elevation tiles are loading for this view…';
      if (!terrainWarning) terrainWarning = setTimeout(warnTerrain, 20000);
    }
  }
}
function warnTerrain() {
  terrainWarning = null;
  if (!terrainReady && map.getTerrain()) {
    $('terrain-status').textContent = 'Terrain tiles are unavailable or still loading. Turn Terrain off for a flat map.';
    $('terrain-status').hidden = false;
  }
}
function setLayers(ids, visible) {
  for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}
function updateCoordinates() {
  const {lat, lng} = map.getCenter();
  $('coordinates').textContent = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;
}
function showFeature(event) {
  if (($('network-toggle').checked || $('bell-toggle').checked) && map.getLayer('network-sites')) {
    const hit = map.queryRenderedFeatures(event.point,{layers:['network-sector-arrows','network-sites','network-sector-fans','network-site-fans-selected-fill']})[0];
    if (hit) {
      const feature = networkFeatures?.find(f => f.properties.site_id === hit.properties.site_id);
      if (feature) { selectNetwork(feature,false,['network-sector-fans','network-site-fans-selected-fill'].includes(hit.layer.id) ? Number(hit.properties.azimuth) : null); return; }
    }
  }
  const features = map.queryRenderedFeatures(event.point).filter(feature => feature.source === 'openmaptiles');
  if (!features.length) { markerLayer?.setLocation(null); return; }
  const feature = features.find(f => f.sourceLayer === 'building') || features[0];
  const details = featureDetails(feature);
  markerLayer?.setLocation(event.lngLat, details.height);
}

map.on('load', () => {
  loadFinished = true;
  map.addSource('terrain-dem', {
    type: 'raster-dem', tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'], tileSize: 512,
    encoding: 'terrarium', maxzoom: 12, attribution: '<a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener noreferrer">© Mapterhorn terrain</a>'
  });
  map.setTerrain({source: 'terrain-dem', exaggeration: 1});
  map.setLight(mapLight(lighting));
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'fill' && layer['source-layer'] === 'water') {
      map.setPaintProperty(layer.id, 'fill-color', '#9ec7d0');
    }
  }
  map.addSource('trees-overview', {
    type: 'geojson', data: './trees/overview.geojson', cluster: true, clusterRadius: 36, clusterMaxZoom: 14,
  });
  const firstLabel = map.getStyle().layers.find(layer => layer.type === 'symbol')?.id;
  map.addSource('building-shadows', {type:'geojson', data:emptyFeatures});
  map.addLayer({id:'building-shadows', type:'fill', source:'building-shadows', minzoom:15,
    paint:{'fill-color':'#30453e', 'fill-opacity':0.13}}, map.getLayer('building-3d') ? 'building-3d' : firstLabel);
  map.addLayer({
    id: 'trees-overview-points', type: 'circle', source: 'trees-overview', maxzoom: 15,
    filter: ['!', ['has', 'point_count']],
    paint: {'circle-color':['case',['==',['get','estimated'],1],'#728f51','#43804d'], 'circle-opacity':.8, 'circle-radius':['interpolate',['linear'],['zoom'],5,1.5,14,3]},
  }, firstLabel);
  const groups = layerGroups(map.getStyle().layers);
  streetLayers = groups.streets; buildingLayers = groups.buildings;
  if (map.getLayer('building-3d')) {
    map.setPaintProperty('building-3d', 'fill-extrusion-height', ['case', ['boolean', ['feature-state', 'osm_roof'], false], 0, ['coalesce', ['get', 'render_height'], 0]]);
    map.setPaintProperty('building-3d', 'fill-extrusion-base', ['case', ['boolean', ['feature-state', 'osm_roof'], false], 0, ['coalesce', ['get', 'render_min_height'], 0]]);
    map.setPaintProperty('building-3d', 'fill-extrusion-color', ['to-color', ['get', 'colour'], '#d8d9d3']);
    map.setPaintProperty('building-3d', 'fill-extrusion-opacity', 1);
  }
  roofLayer = createRoofLayer(map, text => reportLayerStatus('roof-status', 'Buildings', text)); map.addLayer(roofLayer);
  treeLayer = createTreeLayer(map, text => reportLayerStatus('tree-status', 'Trees', text)); map.addLayer(treeLayer);
  streetDetailLayer = createStreetDetailLayer(map, text => reportLayerStatus('street-status', 'Street details', text)); map.addLayer(streetDetailLayer);
  for (const layer of [roofLayer, treeLayer, streetDetailLayer]) layer.setLighting(lighting);
  map.addSource('network-sites',{type:'geojson',data:emptyFeatures});
  map.addSource('network-sectors',{type:'geojson',data:emptyFeatures});
  map.addSource('network-sector-fans',{type:'geojson',data:emptyFeatures});
  map.addSource('network-site-fans-selected',{type:'geojson',data:emptyFeatures});
  map.addSource('network-sector-selected',{type:'geojson',data:emptyFeatures});
  map.addSource('network-selected-site',{type:'geojson',data:emptyFeatures});
  const sectorColor = ['match',['get','sector'],1,'#ee5a55',2,'#147fb5',3,'#8b4fa8','#6b776d'];
  map.addLayer({id:'network-sector-fans',type:'fill',source:'network-sector-fans',layout:{visibility:'none'},paint:{'fill-color':sectorColor,'fill-opacity':['interpolate',['linear'],['zoom'],10,.045,14,.105,17,.18]}});
  map.addLayer({id:'network-sector-outlines',type:'line',source:'network-sector-fans',layout:{visibility:'none'},paint:{'line-color':sectorColor,'line-opacity':['interpolate',['linear'],['zoom'],10,.2,14,.5,17,.65],'line-width':1}});
  map.addLayer({id:'network-site-fans-selected-fill',type:'fill',source:'network-site-fans-selected',layout:{visibility:'none'},paint:{'fill-color':sectorColor,'fill-opacity':.20}});
  map.addLayer({id:'network-site-fans-selected-halo',type:'line',source:'network-site-fans-selected',layout:{visibility:'none'},paint:{'line-color':'#ffffff','line-width':3.5,'line-opacity':.9}});
  map.addLayer({id:'network-site-fans-selected-line',type:'line',source:'network-site-fans-selected',layout:{visibility:'none'},paint:{'line-color':sectorColor,'line-width':1.8}});
  map.addLayer({id:'network-sector-selected-fill',type:'fill',source:'network-sector-selected',layout:{visibility:'none'},paint:{'fill-color':sectorColor,'fill-opacity':.24}});
  map.addLayer({id:'network-sector-selected-halo',type:'line',source:'network-sector-selected',layout:{visibility:'none'},paint:{'line-color':'#ffffff','line-width':5,'line-opacity':.95}});
  map.addLayer({id:'network-sector-selected-line',type:'line',source:'network-sector-selected',layout:{visibility:'none'},paint:{'line-color':sectorColor,'line-width':2.5}});
  updateFanIntensity();
  map.addLayer({id:'network-sites',type:'circle',source:'network-sites',layout:{visibility:'none'},paint:{'circle-color':['match',['get','site_class'],'indoor','#087f9f','outdoor','#7b43a3','bell','#c87512','#77867c'],'circle-radius':['interpolate',['linear'],['zoom'],8,3,16,6],'circle-stroke-color':'#ffffff','circle-stroke-width':1.5,'circle-opacity':.95}});
  map.addLayer({id:'network-omni-rings',type:'circle',source:'network-sites',layout:{visibility:'none'},filter:['==',['get','antenna_pattern'],'omni'],paint:{'circle-color':'#087f9f','circle-opacity':0,'circle-radius':['interpolate',['linear'],['zoom'],8,6,16,10],'circle-stroke-color':'#087f9f','circle-stroke-width':1.5,'circle-stroke-opacity':.9}});
  map.addLayer({id:'network-selected-site-ring',type:'circle',source:'network-selected-site',layout:{visibility:'none'},paint:{'circle-color':'#ffffff','circle-opacity':0,'circle-radius':12,'circle-stroke-color':'#183b33','circle-stroke-width':3}});
  function addBearingImage(id,color) {
    const arrow = document.createElement('canvas'); arrow.width = 48; arrow.height = 48;
    const context = arrow.getContext('2d'); context.lineJoin = 'round'; context.lineCap = 'round';
    context.beginPath(); context.moveTo(24,25); context.lineTo(24,14); context.moveTo(17,15); context.lineTo(24,4); context.lineTo(31,15); context.closePath();
    context.fillStyle = color; context.strokeStyle = '#ffffff'; context.lineWidth = 4; context.stroke(); context.fill();
    context.beginPath(); context.moveTo(24,25); context.lineTo(24,14); context.strokeStyle = '#ffffff'; context.lineWidth = 5; context.stroke(); context.strokeStyle = color; context.lineWidth = 2.5; context.stroke();
    map.addImage(id,context.getImageData(0,0,48,48),{pixelRatio:2});
  }
  addBearingImage('telus-bearing','#087f9f'); addBearingImage('bell-bearing','#c87512');
  map.addLayer({id:'network-sector-arrows',type:'symbol',source:'network-sectors',minzoom:14,layout:{visibility:'none','icon-image':['match',['get','provider'],'Bell','bell-bearing','telus-bearing'],'icon-allow-overlap':true,'icon-ignore-placement':true,'icon-rotation-alignment':'map','icon-rotate':['get','azimuth']}});
  networkLayer = createNetworkLayer(map); map.addLayer(networkLayer);
  if ($('network-toggle').checked || $('bell-toggle').checked) showNetwork();
  markerLayer = createMarkerLayer(); map.addLayer(markerLayer);
  $('loading').hidden = true; $('error').hidden = true;
  terrainWarning = setTimeout(warnTerrain, 20000);
  updateCoordinates();
});
map.on('idle', () => { terrainStatus(); roofLayer?.refresh(); treeLayer?.refresh(); streetDetailLayer?.refresh(); networkLayer?.refresh(); refreshNetwork(); if ($('shadows-toggle').checked) refreshShadows(); });
map.on('moveend', refreshShadows);
map.on('moveend', () => { updateCoordinates(); terrainStatus(); });
map.on('click', showFeature);
map.on('mouseenter','network-sector-fans',()=>{ map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave','network-sector-fans',()=>{ map.getCanvas().style.cursor = ''; });
map.on('error', event => {
  if (event.sourceId === 'terrain-dem' && map.getTerrain()) {
    terrainTileError = true; terrainReady = false; clearTimeout(terrainWarning); terrainWarning = null;
    $('terrain-status').textContent = 'Some terrain tiles could not be loaded. Turn Terrain off for a flat map.';
    $('terrain-status').hidden = false;
  }
  console.warn('Map resource:', event.error?.message || event.error);
});
setTimeout(() => { if (!loadFinished) { $('loading').hidden = true; $('error').hidden = false; } }, 20000);
$('retry').onclick = () => location.reload();
const searchForm = $('location-search'), searchQuery = $('location-query'), searchPanel = $('search-results'), searchStatus = $('search-status'), searchList = $('search-list');
searchForm.onsubmit = async event => {
  event.preventDefault();
  const query = searchQuery.value.trim();
  if (!query) { searchQuery.focus(); return; }
  const submit = searchForm.querySelector('button[type="submit"]');
  submit.disabled = true; searchPanel.hidden = false; searchList.replaceChildren(); searchStatus.textContent = 'Searching…';
  try {
    const params = new URLSearchParams({q:query, limit:'5', lat:String(map.getCenter().lat), lon:String(map.getCenter().lng)});
    const response = await fetch(`https://photon.komoot.io/api/?${params}`, {signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('Search service unavailable');
    const results = searchResults(await response.json());
    if (searchQuery.value.trim() !== query) { searchPanel.hidden = true; return; }
    searchStatus.textContent = results.length ? 'Choose a location' : 'No locations found.';
    for (const result of results) {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.textContent = result.label;
      button.onclick = () => { map.flyTo({center:result.coordinates, zoom:15, pitch:55}); searchQuery.value = result.label; searchPanel.hidden = true; };
      item.append(button); searchList.append(item);
    }
  } catch {
    if (searchQuery.value.trim() === query) searchStatus.textContent = 'Search unavailable. Please try again.';
  } finally { submit.disabled = false; }
};
searchQuery.oninput = () => { searchPanel.hidden = true; };
searchForm.onkeydown = event => { if (event.key === 'Escape') { searchPanel.hidden = true; searchQuery.focus(); } };
$('city-view').onclick = () => map.flyTo(CITY);
$('harbourfront').onclick = () => map.flyTo(HARBOURFRONT);
for (const [id, center] of Object.entries(DISTRICTS)) $(id).onclick = () => map.flyTo({center, zoom: 14.5, pitch: 55, bearing: 0});
$('reset').onclick = () => map.flyTo(CITY);
$('zoom-in').onclick = () => map.zoomIn(); $('zoom-out').onclick = () => map.zoomOut();
$('tilt-up').onclick = () => map.easeTo({pitch:Math.min(map.getMaxPitch(),map.getPitch()+15)});
$('tilt-down').onclick = () => map.easeTo({pitch:Math.max(map.getMinPitch(),map.getPitch()-15)});
$('rotate-left').onclick = () => map.rotateTo(map.getBearing()-45);
$('rotate-right').onclick = () => map.rotateTo(map.getBearing()+45);
$('north').onclick = () => map.resetNorth();
function updateCameraControls() {
  $('zoom-in').disabled = map.getZoom() >= map.getMaxZoom();
  $('zoom-out').disabled = map.getZoom() <= map.getMinZoom();
  $('tilt-up').disabled = map.getPitch() >= map.getMaxPitch();
  $('tilt-down').disabled = map.getPitch() <= map.getMinPitch();
  $('north').firstElementChild.style.transform = `rotate(${-map.getBearing()}deg)`;
}
map.on('zoom', updateCameraControls); map.on('pitch', updateCameraControls); map.on('rotate', updateCameraControls);
updateCameraControls();
$('buildings-toggle').onchange = event => { setLayers(buildingLayers, event.target.checked); roofLayer?.setVisible(event.target.checked); refreshShadows(); };
$('shadows-toggle').onchange = refreshShadows;
$('network-toggle').onchange = () => { clearNetworkSelection(); showNetwork(); };
$('bell-toggle').onchange = () => { clearNetworkSelection(); showNetwork(); };
$('sector-fans-toggle').onchange = event => { setLayers(['network-sector-fans','network-sector-outlines','network-site-fans-selected-fill','network-site-fans-selected-halo','network-site-fans-selected-line','network-sector-selected-fill','network-sector-selected-halo','network-sector-selected-line'],event.target.checked && ($('network-toggle').checked || $('bell-toggle').checked)); updateCoverage(); };
$('coverage-focus').onchange = updateCoverage;
$('fan-intensity').oninput = updateFanIntensity;
$('network-search').oninput = () => { networkListSignature = null; refreshNetwork(); };
$('coverage-mode').value = RADIO_DEFAULTS.mode; $('coverage-eirp').value = RADIO_DEFAULTS.eirpDbm; $('coverage-threshold').value = RADIO_DEFAULTS.thresholdDbm;
for (const id of ['coverage-mode','coverage-eirp','coverage-threshold']) $(id).oninput = updateCoverage;
$('network-close').onclick = () => { $('network-toggle').checked = false; $('bell-toggle').checked = false; showNetwork(); };
$('trees-toggle').onchange = event => {
  setLayers(['trees-overview-points'], event.target.checked);
  treeLayer?.setVisible(event.target.checked);
};
$('streets-toggle').onchange = event => setLayers(streetLayers, event.target.checked);
$('street-detail-toggle').onchange = event => streetDetailLayer?.setVisible(event.target.checked);
$('terrain-toggle').onchange = event => {
  if (!map.getSource('terrain-dem')) return;
  map.setTerrain(event.target.checked ? {source:'terrain-dem', exaggeration:1} : null); terrainStatus();
};
