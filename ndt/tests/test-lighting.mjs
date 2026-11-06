import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import { addSceneLights, setSceneLight, lightPresets, mapLight } from '../dist/lighting.mjs';
import { shadowFeatures } from '../dist/shadows.mjs';

const scene = new THREE.Scene();
const light = addSceneLights(scene);
assert.deepEqual(light.position.toArray(), [1,1,3], 'the default light comes from the southeast');
const ring = [[-79.39,43.64],[-79.389,43.64],[-79.389,43.641],[-79.39,43.641],[-79.39,43.64]];
for (const [name, preset] of Object.entries(lightPresets)) {
  setSceneLight(light,preset);
  assert.deepEqual(light.position.toArray(),preset.direction, `${name} updates the 3D scene light`);
  const position = mapLight(preset).position;
  assert.equal(position[1],preset.azimuth, `${name} updates the map light`);
  const horizontal = Math.hypot(...preset.direction.slice(0,2));
  assert.ok(Math.abs(Math.tan(position[2]*Math.PI/180)-horizontal/preset.direction[2])<1e-10, 'map and scene light elevations agree');
  const shadow = shadowFeatures([{properties:{render_height:30},geometry:{type:'Polygon',coordinates:[ring]}}],1500,preset.direction);
  const shifted = shadow.features[0].geometry.coordinates[0][0];
  assert.equal(Math.sign(shifted[0]-ring[0][0]),-Math.sign(preset.direction[0]), 'shadows project away from the light east-west');
  assert.equal(Math.sign(shifted[1]-ring[0][1]),Math.sign(preset.direction[1]), 'shadows project away from the light north-south');
}
console.log('Map, scene and projected shadow lighting directions passed.');
