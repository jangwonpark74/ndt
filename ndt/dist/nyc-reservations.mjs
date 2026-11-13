import { createReservationsModel } from './reservations-model.mjs';
import { createReservationsViewModel } from './reservations-view-model.mjs';
import {openContextPanel,hideContextPanel} from './context-panel.mjs';

// NYC pole reservations are administrative records, not confirmed radio cells.
export function createNycReservations(map, base) {
  const $ = id => document.getElementById(id);
  const viewModel = createReservationsViewModel(createReservationsModel(base));
  const empty = {type:'FeatureCollection', features:[]};
  map.addSource('nyc-reservations', {type:'geojson', data:empty});
  map.addLayer({id:'nyc-reservations',type:'circle',source:'nyc-reservations',filter:['!=',['get','status'],'Proposed'],paint:{
    'circle-color':['match',['get','status'],'Installed','#ad3138','Approved','#dc812a','#68756e'],
    'circle-radius':['interpolate',['linear'],['zoom'],8,3,16,6], 'circle-stroke-color':'#ffffff','circle-stroke-width':1.5
  }});
  function show(feature, move = false) {
    viewModel.select(feature);
    openContextPanel('nyc-panel');
    const p = feature.properties, detail = $('nyc-detail');
    detail.replaceChildren(); detail.hidden = false;
    const title = document.createElement('strong'); title.textContent = `NY SMSA · ${p.status || 'Status unknown'} · reservation ${p.id}`;
    const description = document.createElement('p');
    description.textContent = `${p.on_street || 'Street not reported'}${p.cross_street_1 ? ` near ${p.cross_street_1}` : ''} · ${p.borough || 'Borough not reported'} · ${p.pole_type || 'Pole type not reported'}${p.reservation_date ? ` · Reserved ${p.reservation_date.slice(0,10)}` : ''}${p.installation_date ? ` · Installed ${p.installation_date.slice(0,10)}` : ''}`;
    detail.append(title, description);
    document.dispatchEvent(new CustomEvent('reservationselected',{detail:feature}));
    if (move) map.flyTo({center:feature.geometry.coordinates,zoom:Math.max(map.getZoom(),16),pitch:55});
  }
  function refresh() {
    if (!viewModel.getState().visible) {
      $('nyc-status').textContent = 'Reservation layer is off. Enable Pole reservations in Network settings.';
      $('nyc-list-status').textContent = 'No reservation layer enabled'; $('nyc-list').replaceChildren(); return;
    }
    const bounds = map.getBounds(), results = viewModel.results(point=>bounds.contains(point),map.getCenter());
    if (!results) return;
    $('nyc-status').textContent = `In view: ${results.inView.toLocaleString()} markers · ${results.total.toLocaleString()} in the NYC snapshot`;
    $('nyc-list-status').textContent = results.query ? `${results.count.toLocaleString()} matching reservations${results.count > 8 ? ' · showing nearest 8' : ''}` : `Nearby reservations${results.count > 8 ? ' · showing nearest 8' : ''}`;
    const list = $('nyc-list'); list.replaceChildren();
    for (const feature of results.features) {
      const p = feature.properties, button = document.createElement('button'); button.type = 'button';
      button.textContent = `${p.status || 'Unknown'} · ${p.on_street || p.id} · ${p.borough || 'NYC'}`;
      button.onclick = () => show(feature,true); list.append(button);
    }
  }
  async function update() {
    const visible = $('nyc-poles-toggle').checked;
    viewModel.setVisible(visible);
    if (visible) openContextPanel('nyc-panel'); else hideContextPanel('nyc-panel');
    map.setLayoutProperty('nyc-reservations','visibility',visible ? 'visible' : 'none');
    if (!visible || viewModel.getState().features) { refresh(); return; }
    $('nyc-status').textContent = 'Loading reservations…';
    try {
      const features = await viewModel.load();
      map.getSource('nyc-reservations').setData({type:'FeatureCollection',features}); refresh();
    } catch (error) { $('nyc-status').textContent = 'Reservation data unavailable. Turn the layer off and on to retry.'; console.warn(error); }
  }
  $('nyc-poles-toggle').onchange = update;
  $('nyc-network-settings').addEventListener('toggle',event=>{
    if (event.target.open && $('nyc-poles-toggle').checked) openContextPanel('nyc-panel');
  });
  $('nyc-search').oninput = event => { viewModel.setQuery(event.target.value); refresh(); };
  map.on('moveend', refresh);
  update();
  return {
    click(event) {
      const {visible, features} = viewModel.getState();
      if (!visible || !features) return false;
      const hit = map.queryRenderedFeatures(event.point,{layers:['nyc-reservations']})[0];
      const feature = hit && features.find(f=>f.properties.id === hit.properties.id);
      if (!feature) return false;
      show(feature); return true;
    }
  };
}
