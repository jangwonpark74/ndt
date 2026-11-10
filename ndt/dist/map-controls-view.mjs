export function createMapControlsView({map,viewModel,lighting,emptyFeatures,getBuildingLayers,getStreetLayers,getRoofLayer,getTreeLayer,getStreetDetailLayer}) {
  const $ = id => document.getElementById(id);
  let shadowSignature = '';
  function setLayers(ids,visible) {
    for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id,'visibility',visible ? 'visible' : 'none');
  }
  function cameraSnapshot() {
    viewModel.setCamera({center:map.getCenter(),zoom:map.getZoom(),minZoom:map.getMinZoom(),maxZoom:map.getMaxZoom(),
      pitch:map.getPitch(),minPitch:map.getMinPitch(),maxPitch:map.getMaxPitch(),bearing:map.getBearing()});
  }
  function cameraAction(action) {
    cameraSnapshot();
    const {method,value} = viewModel.cameraCommand(action);
    if (value === undefined) map[method](); else map[method](value);
  }
  function terrainStatus() {
    const enabled = Boolean(map.getTerrain());
    viewModel.observeTerrain(enabled,enabled ? map.queryTerrainElevation(map.getCenter()) : null);
  }
  function terrainError() {if (map.getTerrain()) viewModel.terrainError();}
  function refreshShadows() {
    const source = map.getSource('building-shadows');
    if (!source) return;
    const {layers} = viewModel.getState(), zoom = map.getZoom();
    const enabled = layers.shadows && layers.buildings && zoom >= 15;
    const features = enabled ? map.querySourceFeatures('openmaptiles',{sourceLayer:'building'}) : [];
    const {data,status} = viewModel.shadows(zoom,features,lighting.direction);
    $('shadow-status').textContent = status;
    if (!enabled) {if (shadowSignature) {shadowSignature = ''; source.setData(emptyFeatures);} return;}
    const signature = JSON.stringify(data);
    if (signature !== shadowSignature) {shadowSignature = signature; source.setData(data);}
  }
  function reportLayerStatus(id,control,text) {viewModel.reportLayerStatus(id,control,text);}
  viewModel.subscribe(state=>{
    if (state.camera) {
      const camera = state.camera;
      $('coordinates').textContent = camera.coordinates;
      $('zoom-in').disabled = camera.zoomInDisabled; $('zoom-out').disabled = camera.zoomOutDisabled;
      $('tilt-up').disabled = camera.tiltUpDisabled; $('tilt-down').disabled = camera.tiltDownDisabled;
      $('north').firstElementChild.style.transform = `rotate(${camera.northRotation}deg)`;
    }
    $('terrain-status').textContent = state.terrain.text; $('terrain-status').hidden = state.terrain.hidden;
    for (const [id,status] of Object.entries(state.layerStatuses)) {$(id).textContent = status.text; $(id).hidden = status.hidden;}
  });
  for (const [id,action] of [['reset','reset'],['zoom-in','zoom-in'],['zoom-out','zoom-out'],['tilt-up','tilt-up'],['tilt-down','tilt-down'],['rotate-left','rotate-left'],['rotate-right','rotate-right'],['north','north']]) $(id).onclick = () => cameraAction(action);
  for (const event of ['zoom','pitch','rotate','moveend']) map.on(event,cameraSnapshot);
  cameraSnapshot();
  $('buildings-toggle').onchange = event => {viewModel.setLayer('buildings',event.target.checked); setLayers(getBuildingLayers(),event.target.checked); getRoofLayer()?.setVisible(event.target.checked); refreshShadows();};
  $('shadows-toggle').onchange = event => {viewModel.setLayer('shadows',event.target.checked); refreshShadows();};
  $('trees-toggle').onchange = event => {viewModel.setLayer('trees',event.target.checked); setLayers(['trees-overview-points'],event.target.checked); getTreeLayer()?.setVisible(event.target.checked);};
  $('streets-toggle').onchange = event => {viewModel.setLayer('streets',event.target.checked); setLayers(getStreetLayers(),event.target.checked);};
  $('street-detail-toggle').onchange = event => {viewModel.setLayer('streetDetails',event.target.checked); getStreetDetailLayer()?.setVisible(event.target.checked);};
  $('terrain-toggle').onchange = event => {
    viewModel.setLayer('terrain',event.target.checked);
    if (!map.getSource('terrain-dem')) return;
    map.setTerrain(event.target.checked ? {source:'terrain-dem',exaggeration:1} : null); terrainStatus();
  };
  return {setLayers,terrainStatus,terrainError,refreshShadows,reportLayerStatus};
}
