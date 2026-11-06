import * as THREE from './vendor/three.module.js';

// Local coordinates are east, south and up; azimuth is clockwise from north.
export const lightPresets = {
  northwest:{azimuth:315, direction:[-1,-1,3]},
  northeast:{azimuth:45, direction:[1,-1,3]},
  southeast:{azimuth:135, direction:[1,1,3]},
  southwest:{azimuth:225, direction:[-1,1,3]},
};
export const mapLight = preset => ({anchor:'map', color:'#ffffff', intensity:0.5,
  position:[1.15,preset.azimuth,Math.atan2(Math.hypot(preset.direction[0],preset.direction[1]),preset.direction[2])*180/Math.PI]});
export function setSceneLight(light, preset) { light.position.set(...preset.direction); }
export function addSceneLights(scene, preset = lightPresets.southeast) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9b9a8f, 2));
  const light = new THREE.DirectionalLight(0xffffff, 1);
  setSceneLight(light, preset);
  scene.add(light);
  return light;
}
