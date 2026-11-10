import {shadowFeatures} from './shadows.mjs';

const empty = {type:'FeatureCollection',features:[]};
export function createMapControlsViewModel(city, initialLayers, options = {}) {
  const schedule = options.schedule || setTimeout, cancel = options.cancel || clearTimeout;
  const createShadows = options.createShadows || shadowFeatures;
  let timer = null;
  let state = {layers:{...initialLayers},camera:null,terrain:{enabled:false,ready:false,tileError:false,hidden:true,text:'Loading terrain…'},layerStatuses:{}};
  const listeners = new Set();
  const update = changes => {state = {...state,...changes}; for (const listener of listeners) listener(state);};
  const stopTimer = () => {if (timer !== null) cancel(timer); timer = null;};
  const setTerrain = changes => update({terrain:{...state.terrain,...changes}});
  const warnTerrain = () => {
    timer = null;
    if (state.terrain.enabled && !state.terrain.ready && !state.terrain.tileError) setTerrain({hidden:false,text:'Terrain tiles are unavailable or still loading. Turn Terrain off for a flat map.'});
  };
  return {
    getState: () => state,
    subscribe(listener) {listeners.add(listener); listener(state); return () => listeners.delete(listener);},
    setLayer(name,visible) {update({layers:{...state.layers,[name]:visible}});},
    setCamera(camera) {
      const {center,zoom,minZoom,maxZoom,pitch,minPitch,maxPitch,bearing} = camera;
      update({camera:{...camera,coordinates:`${Math.abs(center.lat).toFixed(4)}° ${center.lat >= 0 ? 'N' : 'S'}  ${Math.abs(center.lng).toFixed(4)}° ${center.lng >= 0 ? 'E' : 'W'}`,
        zoomInDisabled:zoom >= maxZoom,zoomOutDisabled:zoom <= minZoom,tiltUpDisabled:pitch >= maxPitch,tiltDownDisabled:pitch <= minPitch,northRotation:-bearing}});
    },
    cameraCommand(action) {
      const camera = state.camera;
      if (action === 'overview' || action === 'reset') return {method:'flyTo',value:city};
      if (action === 'zoom-in') return {method:'zoomIn'};
      if (action === 'zoom-out') return {method:'zoomOut'};
      if (action === 'north') return {method:'resetNorth'};
      if (action === 'tilt-up') return {method:'easeTo',value:{pitch:Math.min(camera.maxPitch,camera.pitch+15)}};
      if (action === 'tilt-down') return {method:'easeTo',value:{pitch:Math.max(camera.minPitch,camera.pitch-15)}};
      if (action === 'rotate-left') return {method:'rotateTo',value:camera.bearing-45};
      if (action === 'rotate-right') return {method:'rotateTo',value:camera.bearing+45};
      throw new Error('Unknown camera action');
    },
    observeTerrain(enabled,elevation) {
      if (!enabled) {stopTimer(); setTerrain({enabled:false,ready:false,tileError:false,hidden:true,text:'Terrain is off.'}); return;}
      if (state.terrain.tileError) return;
      if (Number.isFinite(elevation)) {
        stopTimer(); setTerrain({enabled:true,ready:true,hidden:true,text:`Terrain elevation near map center: ${Math.round(elevation)} m.`});
      } else {
        const hidden = state.terrain.hidden;
        setTerrain({enabled:true,ready:false,...(hidden ? {text:'Elevation tiles are loading for this view…'} : {})});
        if (hidden && timer === null) timer = schedule(warnTerrain,20000);
      }
    },
    terrainError() {stopTimer(); setTerrain({enabled:true,ready:false,tileError:true,hidden:false,text:'Some terrain tiles could not be loaded. Turn Terrain off for a flat map.'});},
    reportLayerStatus(id,control,text) {
      const unavailable = text.includes('unavailable');
      const status = {text:unavailable ? `${text} Turn ${control} off and on to retry.` : text,hidden:!unavailable};
      update({layerStatuses:{...state.layerStatuses,[id]:status}});
    },
    shadows(zoom,features,direction) {
      if (!state.layers.shadows || !state.layers.buildings || zoom < 15) return {data:empty,status:state.layers.shadows ? 'Zoom in with buildings on to see shadows.' : 'Lighting, shadows and street models are illustrative.'};
      const data = createShadows(features,1500,direction);
      return {data,status:data.features.length ? 'Lighting, shadows and street models are illustrative.' : 'No building shadows available in this view.'};
    },
  };
}
