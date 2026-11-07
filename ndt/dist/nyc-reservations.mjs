// NYC pole reservations are administrative records, not confirmed radio cells.
export function createNycReservations(map, base) {
  const $ = id => document.getElementById(id);
  let features = null, loading = false;
  const empty = {type:'FeatureCollection', features:[]};
  map.addSource('nyc-reservations', {type:'geojson', data:empty});
  map.addLayer({id:'nyc-reservations',type:'circle',source:'nyc-reservations',filter:['!=',['get','status'],'Proposed'],paint:{
    'circle-color':['match',['get','status'],'Installed','#ad3138','Approved','#dc812a','#68756e'],
    'circle-radius':['interpolate',['linear'],['zoom'],8,3,16,6], 'circle-stroke-color':'#ffffff','circle-stroke-width':1.5
  }});
  function show(feature, move = false) {
    const p = feature.properties, detail = $('nyc-detail');
    detail.replaceChildren(); detail.hidden = false;
    const title = document.createElement('strong'); title.textContent = `NY SMSA · ${p.status || 'Status unknown'} · reservation ${p.id}`;
    const description = document.createElement('p');
    description.textContent = `${p.on_street || 'Street not reported'}${p.cross_street_1 ? ` near ${p.cross_street_1}` : ''} · ${p.borough || 'Borough not reported'} · ${p.pole_type || 'Pole type not reported'}${p.reservation_date ? ` · Reserved ${p.reservation_date.slice(0,10)}` : ''}${p.installation_date ? ` · Installed ${p.installation_date.slice(0,10)}` : ''}`;
    detail.append(title, description);
    if (move) map.flyTo({center:feature.geometry.coordinates,zoom:Math.max(map.getZoom(),16),pitch:55});
  }
  function refresh() {
    if (!features || !$('nyc-poles-toggle').checked) return;
    const bounds = map.getBounds(), center = map.getCenter(), query = $('nyc-search').value.trim().toLowerCase();
    const nearby = features.filter(f=>bounds.contains(f.geometry.coordinates));
    const results = (query ? features.filter(f=>Object.values(f.properties).some(v=>String(v).toLowerCase().includes(query))) : nearby).slice();
    results.sort((a,b)=>Math.hypot(a.geometry.coordinates[0]-center.lng,a.geometry.coordinates[1]-center.lat)-Math.hypot(b.geometry.coordinates[0]-center.lng,b.geometry.coordinates[1]-center.lat));
    $('nyc-status').textContent = `In view: ${nearby.filter(f=>f.properties.status !== 'Proposed').length.toLocaleString()} markers · ${features.length.toLocaleString()} in the NYC snapshot`;
    $('nyc-list-status').textContent = query ? `${results.length.toLocaleString()} matching reservations${results.length > 8 ? ' · showing nearest 8' : ''}` : `Nearby reservations${results.length > 8 ? ' · showing nearest 8' : ''}`;
    const list = $('nyc-list'); list.replaceChildren();
    for (const feature of results.slice(0,8)) {
      const p = feature.properties, button = document.createElement('button'); button.type = 'button';
      button.textContent = `${p.status || 'Unknown'} · ${p.on_street || p.id} · ${p.borough || 'NYC'}`;
      button.onclick = () => show(feature,true); list.append(button);
    }
  }
  async function update() {
    const visible = $('nyc-poles-toggle').checked;
    $('nyc-panel').hidden = !visible;
    map.setLayoutProperty('nyc-reservations','visibility',visible ? 'visible' : 'none');
    if (!visible || features || loading) { refresh(); return; }
    loading = true; $('nyc-status').textContent = 'Loading reservations…';
    try {
      const response = await fetch(`${base}/verizon-poles.geojson`);
      if (!response.ok) throw new Error('Reservation data unavailable');
      const data = await response.json();
      if (data.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.every(f=>f.geometry?.type === 'Point' && f.geometry.coordinates?.length === 2 && f.geometry.coordinates.every(Number.isFinite) && typeof f.properties?.id === 'string')) throw new Error('Invalid reservation data');
      features = data.features; map.getSource('nyc-reservations').setData(data); refresh();
    } catch (error) { $('nyc-status').textContent = 'Reservation data unavailable. Turn the layer off and on to retry.'; console.warn(error); }
    finally { loading = false; }
  }
  $('nyc-poles-toggle').onchange = update;
  $('nyc-close').onclick = () => { $('nyc-poles-toggle').checked = false; update(); };
  $('nyc-search').oninput = refresh;
  map.on('moveend', refresh);
  update();
  return {
    click(event) {
      if (!$('nyc-poles-toggle').checked || !features) return false;
      const hit = map.queryRenderedFeatures(event.point,{layers:['nyc-reservations']})[0];
      const feature = hit && features.find(f=>f.properties.id === hit.properties.id);
      if (!feature) return false;
      show(feature); return true;
    }
  };
}
