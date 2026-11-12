import { lightPresets } from './lighting.mjs';
import { searchLocations } from './search.mjs';
import { createSearchViewModel } from './search-view-model.mjs';
import { bindSearchView } from './search-view.mjs';
import { createNetworkModel, siteLocations } from './network-model.mjs';
import { createNetworkViewModel } from './network-view-model.mjs';
import { createNetworkView } from './network-view.mjs';
import { createProjectModel } from './project-model.mjs';
import { createProjectViewModel } from './project-view-model.mjs';
import { createProjectView } from './project-view.mjs';
import { createRegionModel } from './region-model.mjs';
import { createRegionViewModel } from './region-view-model.mjs';
import { renderRegionView, showRegionError } from './region-view.mjs';
import { createMapControlsViewModel } from './map-controls-view-model.mjs';
import { createMapControlsView } from './map-controls-view.mjs';
import { createMapSceneViewModel } from './map-scene-view-model.mjs';
import { createMapSceneView } from './map-scene-view.mjs';
import { createNavigationViewModel } from './navigation-view-model.mjs';
import { bindNavigationView } from './navigation-view.mjs';
import { createTaskModel } from './task-model.mjs';
import { createTaskViewModel } from './task-view-model.mjs';
import { createTaskView } from './task-view.mjs';
import { createVirtualUeView } from './virtual-ue-view.mjs';
import { bindContextPanel } from './context-panel.mjs';

const $ = id => document.getElementById(id);
const regionId = new URLSearchParams(location.search).get('region') || 'toronto';
const regionViewModel = createRegionViewModel(createRegionModel(),regionId);
let region;
try {
  region = await regionViewModel.load();
} catch (error) {
  showRegionError();
  throw error;
}
const assetBase = regionViewModel.assetBase();
renderRegionView(regionViewModel);
bindContextPanel(region.network === 'nyc-poles' ? 'nyc-panel' : 'network-panel');
bindNavigationView(createNavigationViewModel());
const CITY = { center: region.center, zoom: region.zoom, pitch: region.pitch, bearing: 0 };
const map = new maplibregl.Map({
  container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty',
  ...CITY, maxPitch: 75, attributionControl: false,
});
map.addControl(new maplibregl.AttributionControl({compact: false}), 'bottom-right');
const lighting = lightPresets.southeast;
const emptyFeatures = {type:'FeatureCollection', features:[]};
const sceneViewModel = createMapSceneViewModel();
const sceneView = createMapSceneView({map,region,assetBase,lighting,emptyFeatures,viewModel:sceneViewModel,
  getMapView:()=>mapView,getMapViewModel:()=>mapViewModel,getNetworkView:()=>networkView,getProjectView:()=>projectView,getTaskView:()=>taskView,getVirtualUeView:()=>virtualUeView});
const mapViewModel = createMapControlsViewModel(CITY,{
  buildings:$('buildings-toggle').checked,streets:$('streets-toggle').checked,trees:$('trees-toggle').checked,
  terrain:$('terrain-toggle').checked,streetDetails:$('street-detail-toggle').checked,shadows:$('shadows-toggle').checked,
});
const mapView = createMapControlsView({map,viewModel:mapViewModel,lighting,emptyFeatures,
  getBuildingLayers:sceneView.getBuildingLayers,getStreetLayers:sceneView.getStreetLayers,getRoofLayer:sceneView.getRoofLayer,
  getTreeLayer:sceneView.getTreeLayer,getStreetDetailLayer:sceneView.getStreetDetailLayer});
const networkViewModel = createNetworkViewModel(createNetworkModel(assetBase));
const projectViewModel = createProjectViewModel(createProjectModel(region,assetBase),region.projects);
const taskView = createTaskView({map,viewModel:createTaskViewModel(createTaskModel(region.id)),regionId:region.id});
const virtualUeView = createVirtualUeView({map,regionId:region.id});
const projectView = createProjectView({region,map,viewModel:projectViewModel,siteLocations,emptyFeatures,taskView,virtualUeView});
const networkView = createNetworkView({map,region,projectViewModel,viewModel:networkViewModel,projectView,setLayers:mapView.setLayers,getNetworkLayer:sceneView.getNetworkLayer,emptyFeatures});
bindSearchView({form:$('location-search'), query:$('location-query'), panel:$('search-results'), status:$('search-status'), list:$('search-list')}, createSearchViewModel(searchLocations), map);
sceneView.start();
map.once('load',async()=>{
  const params=new URLSearchParams(location.search),project=region.projects.find(p=>p.id===params.get('project'));
  if(project){await projectView.selectProject(project);if(params.get('task'))taskView.selectTask(params.get('task'));}
});
