import assert from 'node:assert/strict';
import {createMapControlsViewModel} from '../../dist/map-controls-view-model.mjs';

let next = 0;
const timers = new Map(), cancelled = [];
const city = {center:[-79,43],zoom:10,pitch:45,bearing:0};
const vm = createMapControlsViewModel(city,{buildings:true,shadows:false}, {
  schedule:(fn,delay)=>{assert.equal(delay,20000); const id=++next; timers.set(id,fn); return id;},
  cancel:id=>{cancelled.push(id); timers.delete(id);},
  createShadows:(features,limit,direction)=>{assert.equal(limit,1500); assert.deepEqual(direction,[1,2]); return {type:'FeatureCollection',features};},
});
let state;
vm.subscribe(value=>{state=value;});
vm.setCamera({center:{lat:43.7,lng:-79.4},zoom:22,minZoom:0,maxZoom:22,pitch:70,minPitch:0,maxPitch:75,bearing:30});
assert.equal(state.camera.coordinates,'43.7000° N  79.4000° W');
assert.equal(state.camera.zoomInDisabled,true);
assert.equal(state.camera.northRotation,-30);
assert.deepEqual(vm.cameraCommand('tilt-up'),{method:'easeTo',value:{pitch:75}});
assert.deepEqual(vm.cameraCommand('rotate-left'),{method:'rotateTo',value:-15});
assert.deepEqual(vm.cameraCommand('reset'),{method:'flyTo',value:city});
assert.throws(()=>vm.cameraCommand('invalid'),/Unknown camera action/);
vm.observeTerrain(true,null);
assert.equal(timers.size,1);
timers.get(1)(); timers.delete(1);
assert.equal(state.terrain.hidden,false);
assert.match(state.terrain.text,/unavailable or still loading/);
vm.observeTerrain(true,100);
assert.equal(state.terrain.hidden,true);
assert.match(state.terrain.text,/100 m/);
vm.observeTerrain(true,null);
assert.equal(timers.size,1);
vm.terrainError();
assert.deepEqual(cancelled,[2]);
assert.equal(state.terrain.tileError,true);
vm.observeTerrain(true,0);
assert.match(state.terrain.text,/Some terrain tiles/);
vm.observeTerrain(false,null);
assert.equal(state.terrain.hidden,true);
assert.equal(state.terrain.tileError,false);
vm.observeTerrain(true,null);
assert.equal(timers.size,1);
vm.observeTerrain(false,null);
assert.equal(timers.size,0);
vm.reportLayerStatus('tree-status','Trees','Tree data unavailable.');
assert.equal(state.layerStatuses['tree-status'].hidden,false);
assert.match(state.layerStatuses['tree-status'].text,/Turn Trees off and on to retry/);
vm.reportLayerStatus('tree-status','Trees','Trees in view.');
assert.equal(state.layerStatuses['tree-status'].hidden,true);
assert.match(vm.shadows(14,[],[1,2]).status,/illustrative/);
vm.setLayer('shadows',true);
assert.match(vm.shadows(14,[],[1,2]).status,/Zoom in/);
assert.match(vm.shadows(15,[],[1,2]).status,/No building shadows/);
assert.equal(vm.shadows(15,[{id:1}],[1,2]).data.features.length,1);
vm.setLayer('buildings',false);
assert.match(vm.shadows(15,[{id:1}],[1,2]).status,/Zoom in/);
console.log('Map controls view-model passed.');
