import * as THREE from './vendor/three.module.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { visibleTreeTiles } from './tree-data.mjs';
import { addSceneLights, setSceneLight } from './lighting.mjs';

const ORIGIN = [-79.39,43.70], MIN_ZOOM = 17, MAX_ITEMS = 1000, MAX_DISTANCE = 1200;

export function createStreetDetailLayer(map, report) {
  const origin = maplibregl.MercatorCoordinate.fromLngLat(ORIGIN), unit = origin.meterInMercatorCoordinateUnits();
  const lampPole = new THREE.CylinderGeometry(.07,.09,5,6).rotateX(Math.PI/2).translate(0,0,2.5);
  const lampHead = new THREE.SphereGeometry(.22,8,6).translate(0,0,5);
  const seat = new THREE.BoxGeometry(1.5,.5,.12).translate(0,0,.5);
  const back = new THREE.BoxGeometry(1.5,.08,.6).translate(0,.21,.85);
  const legs = [-.55,.55].map(x => new THREE.BoxGeometry(.08,.4,.45).translate(x,0,.225));
  const lamp = mergeGeometries([lampPole,lampHead]), bench = mergeGeometries([seat,back,...legs]);
  [lampPole,lampHead,seat,back,...legs].forEach(geometry => geometry.dispose());
  const material = new THREE.MeshLambertMaterial({color:'#665f53'});
  const cache = new Map(), pending = new Set(), failed = new Set();
  let renderer, camera, scene, light, manifest, loading = false, visible = true, meshes = [], signature = null, active = new Set();
  function clear() { for (const mesh of meshes) { scene.remove(mesh); mesh.dispose(); } meshes = []; signature = null; }
  function fetchManifest() {
    if (loading || failed.has('manifest')) return;
    loading = true; report('Loading mapped street details…');
    fetch('./street-detail/manifest.json').then(response => {
      if (!response.ok) throw new Error(`Street detail manifest: ${response.status}`);
      return response.json();
    }).then(data => {
      if (data.zoom !== 14 || !data.tiles) throw new Error('Invalid street detail manifest');
      manifest = data;
    }).catch(error => { failed.add('manifest'); console.warn(error); }).finally(() => { loading = false; refresh(); });
  }
  function fetchTile(key) {
    if (cache.has(key) || pending.has(key) || failed.has(key)) return;
    pending.add(key);
    fetch(`./street-detail/${key}.json`).then(response => {
      if (!response.ok) throw new Error(`Street detail tile: ${response.status}`);
      return response.json();
    }).then(data => {
      if (!Array.isArray(data)) throw new Error(`Invalid street detail tile: ${key}`);
      cache.set(key,data);
      while (cache.size > 48) { const key = [...cache.keys()].find(key => !active.has(key)); if (!key) break; cache.delete(key); }
    }).catch(error => { failed.add(key); console.warn(error); }).finally(() => { pending.delete(key); refresh(); });
  }
  function addMesh(geometry, records) {
    if (!records.length) return;
    const mesh = new THREE.InstancedMesh(geometry,material,records.length), object = new THREE.Object3D();
    records.forEach(({record,elevation},index) => {
      const p = maplibregl.MercatorCoordinate.fromLngLat(record.slice(0,2));
      object.position.set((p.x-origin.x)/unit,(p.y-origin.y)/unit,elevation); object.updateMatrix(); mesh.setMatrixAt(index,object.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; scene.add(mesh); meshes.push(mesh);
  }
  function refresh() {
    if (!scene) return;
    if (!visible || map.getZoom() < MIN_ZOOM) {
      if (meshes.length || signature !== null) clear();
      report(visible ? 'Zoom in for mapped street details.' : 'Street details are hidden.'); return;
    }
    if (!manifest) { if (failed.has('manifest')) report('Street details unavailable.'); else fetchManifest(); return; }
    const bounds = map.getBounds(), center = map.getCenter(), keys = visibleTreeTiles(manifest,bounds);
    active = new Set(keys);
    for (const key of keys) { if (pending.size >= 8) break; fetchTile(key); }
    if (keys.some(key => pending.has(key) || (!cache.has(key) && !failed.has(key)))) { report('Loading mapped street details…'); return; }
    const records = [];
    for (const key of keys) for (const record of cache.get(key) || []) {
      if (!bounds.contains(record.slice(0,2))) continue;
      const distance = Math.hypot((record[0]-center.lng)*111320*Math.cos(center.lat*Math.PI/180),(record[1]-center.lat)*111320);
      if (distance <= MAX_DISTANCE && (record[2] === 'lamp' || record[2] === 'bench')) records.push({record,distance});
    }
    records.sort((a,b)=>a.distance-b.distance); records.length = Math.min(records.length,MAX_ITEMS);
    const selected = records.map(item => ({...item,elevation:map.getTerrain() ? map.queryTerrainElevation(item.record.slice(0,2)) : 0})).filter(item => Number.isFinite(item.elevation));
    const next = selected.map(({record,elevation})=>`${record.join(':')}:${Math.round(elevation)}`).join('|');
    if (next === signature) return;
    clear(); signature = next;
    addMesh(lamp,selected.filter(item=>item.record[2]==='lamp')); addMesh(bench,selected.filter(item=>item.record[2]==='bench'));
    report(`${selected.length.toLocaleString()} mapped lamps and benches nearby.${keys.some(key=>failed.has(key)) ? ' Some tiles unavailable.' : ''}`);
    map.triggerRepaint();
  }
  return {
    id:'osm-street-detail', type:'custom', renderingMode:'3d',
    onAdd(mapInstance,gl) { camera = new THREE.Camera(); scene = new THREE.Scene(); light = addSceneLights(scene); renderer = new THREE.WebGLRenderer({canvas:mapInstance.getCanvas(),context:gl,antialias:true}); renderer.autoClear = false; },
    render(gl,args) {
      if (!meshes.length) return;
      const local = new THREE.Matrix4().makeTranslation(origin.x,origin.y,0).scale(new THREE.Vector3(unit,unit,unit));
      camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(local);
      renderer.resetState(); renderer.setViewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight); renderer.render(scene,camera);
    },
    refresh,
    setLighting(preset) { if (light) setSceneLight(light, preset); },
    setVisible(value) { visible = value; if (value) failed.clear(); refresh(); },
    onRemove() { clear(); scene = null; lamp.dispose(); bench.dispose(); material.dispose(); renderer?.dispose(); }
  };
}
