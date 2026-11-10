import * as THREE from 'three';
import {layerGroups} from './map-data.mjs';
import {createRoofLayer} from './roof-layer.mjs';
import {createTreeLayer} from './tree-layer.mjs';
import {mapLight} from './lighting.mjs';
import {createStreetDetailLayer} from './street-detail.mjs';
import {createNetworkLayer} from './network-layer.mjs';
import {createNycReservations} from './nyc-reservations.mjs?v=2';

export function createMapSceneView({map,region,assetBase,lighting,emptyFeatures,viewModel,getMapView,getMapViewModel,getNetworkView,getProjectView,getTaskView}) {
const $ = id => document.getElementById(id);
let markerLayer, roofLayer, treeLayer, streetDetailLayer, networkLayer, nycReservations;
let streetLayers = [], buildingLayers = [];
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

function showFeature(event) {
  if (getTaskView().click(event)) return;
  if (nycReservations?.click(event)) return;
  if (getNetworkView().click(event)) return;
  viewModel.select(map.queryRenderedFeatures(event.point),event.lngLat);
}

function start() {
  viewModel.subscribe(state=>{
    $('loading').hidden = state.phase !== 'loading'; $('error').hidden = state.phase !== 'error';
    if (markerLayer) markerLayer.setLocation(state.selection?.location || null,state.selection?.height || 0);
  });
  $('retry').onclick = () => location.reload();
  viewModel.start();
map.on('load', () => {
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
    type: 'geojson', data: `${assetBase}/trees/overview.geojson`, cluster: true, clusterRadius: 36, clusterMaxZoom: 14,
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
    map.setPaintProperty('building-3d', 'fill-extrusion-color', ['match', ['downcase', ['to-string', ['get', 'colour']]],
      ['red','#f00','#ff0000'], '#b09b8b', ['to-color', ['get', 'colour'], '#d8d9d3']]);
    map.setPaintProperty('building-3d', 'fill-extrusion-opacity', 1);
  }
  roofLayer = createRoofLayer(map, text => getMapView().reportLayerStatus('roof-status', 'Buildings', text),assetBase,region.center,region.roof); map.addLayer(roofLayer);
  treeLayer = createTreeLayer(map, text => getMapView().reportLayerStatus('tree-status', 'Trees', text),assetBase,region.center); map.addLayer(treeLayer);
  streetDetailLayer = createStreetDetailLayer(map, text => getMapView().reportLayerStatus('street-status', 'Street details', text),assetBase,region.center); map.addLayer(streetDetailLayer);
  for (const layer of [roofLayer, treeLayer, streetDetailLayer]) layer.setLighting(lighting);
  map.addSource('network-sites',{type:'geojson',data:emptyFeatures});
  map.addSource('network-sectors',{type:'geojson',data:emptyFeatures});
  map.addSource('network-sector-fans',{type:'geojson',data:emptyFeatures});
  map.addSource('network-site-fans-selected',{type:'geojson',data:emptyFeatures});
  map.addSource('network-sector-selected',{type:'geojson',data:emptyFeatures});
  map.addSource('network-selected-site',{type:'geojson',data:emptyFeatures});
  map.addSource('project-coverage',{type:'geojson',data:emptyFeatures});
  map.addSource('project-sites',{type:'geojson',data:emptyFeatures});
  const sectorColor = ['match',['get','sector'],1,'#ee5a55',2,'#147fb5',3,'#8b4fa8','#6b776d'];
  map.addLayer({id:'network-sector-fans',type:'fill',source:'network-sector-fans',layout:{visibility:'none'},paint:{'fill-color':sectorColor,'fill-opacity':['interpolate',['linear'],['zoom'],10,.045,14,.105,17,.18]}});
  map.addLayer({id:'network-sector-outlines',type:'line',source:'network-sector-fans',layout:{visibility:'none'},paint:{'line-color':sectorColor,'line-opacity':['interpolate',['linear'],['zoom'],10,.2,14,.5,17,.65],'line-width':1}});
  map.addLayer({id:'network-site-fans-selected-fill',type:'fill',source:'network-site-fans-selected',layout:{visibility:'none'},paint:{'fill-color':sectorColor,'fill-opacity':.20}});
  map.addLayer({id:'network-site-fans-selected-halo',type:'line',source:'network-site-fans-selected',layout:{visibility:'none'},paint:{'line-color':'#ffffff','line-width':3.5,'line-opacity':.9}});
  map.addLayer({id:'network-site-fans-selected-line',type:'line',source:'network-site-fans-selected',layout:{visibility:'none'},paint:{'line-color':sectorColor,'line-width':1.8}});
  map.addLayer({id:'network-sector-selected-fill',type:'fill',source:'network-sector-selected',layout:{visibility:'none'},paint:{'fill-color':sectorColor,'fill-opacity':.24}});
  map.addLayer({id:'network-sector-selected-halo',type:'line',source:'network-sector-selected',layout:{visibility:'none'},paint:{'line-color':'#ffffff','line-width':5,'line-opacity':.95}});
  map.addLayer({id:'network-sector-selected-line',type:'line',source:'network-sector-selected',layout:{visibility:'none'},paint:{'line-color':sectorColor,'line-width':2.5}});
  getNetworkView().updateFanIntensity();
  map.addLayer({id:'network-sites',type:'circle',source:'network-sites',layout:{visibility:'none'},paint:{'circle-color':['match',['get','site_class'],'indoor','#087f9f','outdoor','#7b43a3','bell','#c87512','#77867c'],'circle-radius':['interpolate',['linear'],['zoom'],8,3,16,6],'circle-stroke-color':'#ffffff','circle-stroke-width':1.5,'circle-opacity':.95}});
  map.addLayer({id:'network-omni-rings',type:'circle',source:'network-sites',layout:{visibility:'none'},filter:['==',['get','antenna_pattern'],'omni'],paint:{'circle-color':'#087f9f','circle-opacity':0,'circle-radius':['interpolate',['linear'],['zoom'],8,6,16,10],'circle-stroke-color':'#087f9f','circle-stroke-width':1.5,'circle-stroke-opacity':.9}});
  map.addLayer({id:'network-selected-site-ring',type:'circle',source:'network-selected-site',layout:{visibility:'none'},paint:{'circle-color':'#ffffff','circle-opacity':0,'circle-radius':12,'circle-stroke-color':'#183b33','circle-stroke-width':3}});
  map.addLayer({id:'project-boundary-halo',type:'line',source:'project-coverage',layout:{'line-cap':'round'},paint:{'line-color':'#ffffff','line-width':6,'line-opacity':.9,'line-dasharray':[4/3,4/3]}});
  map.addLayer({id:'project-boundary',type:'line',source:'project-coverage',layout:{'line-cap':'round'},paint:{'line-color':'#135a43','line-width':4,'line-dasharray':[2,2]}});
  map.addLayer({id:'project-site-markers',type:'circle',source:'project-sites',paint:{'circle-color':'#135a43','circle-radius':6,'circle-stroke-color':'#ffffff','circle-stroke-width':2}});
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
  networkLayer = createNetworkLayer(map,region.center); map.addLayer(networkLayer);
  if ($('network-toggle').checked || $('bell-toggle').checked) getNetworkView().showNetwork();
  getProjectView().initialize();
  getTaskView().initialize();
  if (region.network === 'nyc-poles') nycReservations = createNycReservations(map,assetBase);
  markerLayer = createMarkerLayer(); map.addLayer(markerLayer);
  viewModel.loaded();
  getMapView().terrainStatus();
});
map.on('idle', () => { getMapView().terrainStatus(); roofLayer?.refresh(); treeLayer?.refresh(); streetDetailLayer?.refresh(); networkLayer?.refresh(); getNetworkView().refreshNetwork(); if (getMapViewModel().getState().layers.shadows) getMapView().refreshShadows(); });
map.on('moveend', getMapView().refreshShadows);
map.on('moveend', getMapView().terrainStatus);
map.on('click', showFeature);
map.on('contextmenu', getProjectView().showProjectSiteMenu);
map.on('mouseenter','network-sector-fans',()=>{ map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave','network-sector-fans',()=>{ map.getCanvas().style.cursor = ''; });
map.on('error', event => {
  if (event.sourceId === 'terrain-dem' && map.getTerrain()) {
    getMapView().terrainError();
  }
  console.warn('Map resource:', event.error?.message || event.error);
});
}
return {start,getBuildingLayers:()=>buildingLayers,getStreetLayers:()=>streetLayers,getRoofLayer:()=>roofLayer,
  getTreeLayer:()=>treeLayer,getStreetDetailLayer:()=>streetDetailLayer,getNetworkLayer:()=>networkLayer};
}
