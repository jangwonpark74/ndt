import * as THREE from './vendor/three.module.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';

export const NETWORK_MIN_ZOOM = 14;
export function siteClass(records) {
  if (!Array.isArray(records) || !records.length) return 'other';
  const types = new Set(records.map(record => record?.site_type));
  if (types.size !== 1) return 'other';
  return types.has('I') ? 'indoor' : types.has('O') ? 'outdoor' : 'other';
}
export function towerHeight(records) {
  if (!Array.isArray(records) || !records.length || records.some(record => record?.site_type !== 'O' || record?.structure_type !== 'T')) return null;
  const heights = records.map(record => {
    const value = typeof record.structure_height === 'string' ? record.structure_height.trim() : '';
    return /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  });
  return heights.every(height => Number.isFinite(height) && height >= 1 && height <= 600 && height === heights[0]) ? heights[0] : null;
}

export function createTowerGeometry() {
  const pieces = [];
  function beam(start, end, radius) {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), direction = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(radius,radius,direction.length(),5);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize()));
    geometry.translate(...a.add(b).multiplyScalar(.5).toArray()); pieces.push(geometry);
  }
  const corners = [[-1,-1],[1,-1],[1,1],[-1,1]];
  const point = (corner,z) => [corner[0]*(1.5-z),corner[1]*(1.5-z),z];
  for (let side=0;side<4;side++) {
    const a = corners[side], b = corners[(side+1)%4];
    beam(point(a,0),point(a,1),.07);
    for (let level=0;level<4;level++) {
      const low=level/4, high=(level+1)/4;
      beam(point(a,low),point(b,low),.045);
      beam(point(a,low),point(b,high),.045);
      beam(point(b,low),point(a,high),.045);
    }
  }
  const geometry = mergeGeometries(pieces); pieces.forEach(piece=>piece.dispose());
  const positions = geometry.getAttribute('position');
  for (let i=0;i<positions.count;i++) positions.setZ(i,Math.max(0,Math.min(1,positions.getZ(i))));
  geometry.computeBoundingBox();
  return geometry;
}

export function validNetworkFeature(feature) {
  const p = feature?.properties, c = feature?.geometry?.coordinates;
  return feature?.geometry?.type === 'Point' && Array.isArray(c) && c.length >= 2 &&
    Number.isFinite(c[0]) && Math.abs(c[0]) <= 180 && Number.isFinite(c[1]) && Math.abs(c[1]) <= 90 &&
    (p?.osm_type === 'node' || p?.osm_type === 'way') && /^\d+$/.test(p?.osm_id) && typeof p.mobile === 'boolean';
}

export function validTelusMatch(feature) {
  const p = feature?.properties;
  return validNetworkFeature(feature) && Number.isFinite(p.match_distance_m) && p.match_distance_m >= 0 && p.match_distance_m <= 30 &&
    Array.isArray(p.licensees) && p.licensees.length > 0 && p.licensees.every(name => typeof name === 'string' && name.toUpperCase().startsWith('TELUS'));
}

function validSite(feature) {
  const p = feature?.properties, c = feature?.geometry?.coordinates;
  return feature?.geometry?.type === 'Point' && Array.isArray(c) && c.length === 2 &&
    Number.isFinite(c[0]) && Math.abs(c[0]) <= 180 && Number.isFinite(c[1]) && Math.abs(c[1]) <= 90 &&
    typeof p?.site_id === 'string' && Number.isInteger(p.record_count) && p.record_count > 0 &&
    Array.isArray(p.records) && p.records.length > 0 && p.records.every(record => record && typeof record.site_type === 'string' && typeof record.structure_type === 'string' && typeof record.tx_ant_height === 'string' && (record.record_count === undefined || Number.isInteger(record.record_count) && record.record_count > 0)) &&
    p.records.reduce((sum,record)=>sum+(record.record_count ?? 1),0) === p.record_count &&
    p.technologies && typeof p.technologies === 'object' && Object.values(p.technologies).every(value => Number.isInteger(value) && value > 0) &&
    Object.values(p.technologies).reduce((sum,value)=>sum+value,0) === p.record_count;
}
export function validTelusSite(feature) {
  const p = feature?.properties;
  return validSite(feature) && Array.isArray(p.licensees) && p.licensees.length > 0 && p.licensees.every(name => typeof name === 'string' && name.toUpperCase().startsWith('TELUS'));
}
export function validBellOutdoorSite(feature) {
  const p = feature?.properties;
  return validSite(feature) && p.provider === 'Bell' && Array.isArray(p.licensees) && p.licensees.length === 1 && p.licensees[0] === 'Bell Mobility Inc.' && p.records.every(record => record.site_type === 'O');
}

export function createNetworkLayer(map, center = [-79.39,43.70]) {
  const origin = maplibregl.MercatorCoordinate.fromLngLat(center);
  const unit = origin.meterInMercatorCoordinateUnits();
  const geometry = createTowerGeometry();
  const materials = {TELUS:new THREE.MeshBasicMaterial({color:0x7b43a3}), Bell:new THREE.MeshBasicMaterial({color:0xc87512})};
  let scene, camera, renderer, meshes = [], features = [], visible = false, signature = null;
  function clear() { for (const mesh of meshes) { scene.remove(mesh); mesh.dispose(); } meshes = []; signature = null; }
  function refresh() {
    if (!scene) return;
    if (!visible || map.getZoom() < NETWORK_MIN_ZOOM) { if (meshes.length) clear(); return; }
    const bounds = map.getBounds();
    const selected = features.filter(f => bounds.contains(f.geometry.coordinates) && towerHeight(f.properties.records) !== null).map(feature => {
      const point = feature.geometry.coordinates, elevation = map.getTerrain() ? map.queryTerrainElevation(point) : 0;
      return {feature,elevation};
    }).filter(item => Number.isFinite(item.elevation));
    const next = selected.map(({feature,elevation})=>`${feature.properties.site_id}:${Math.round(elevation*10)}`).join('|');
    if (signature === next) return;
    clear(); signature = next;
    for (const provider of ['TELUS','Bell']) {
      const items = selected.filter(item => (item.feature.properties.provider || 'TELUS') === provider);
      if (!items.length) continue;
      const mesh = new THREE.InstancedMesh(geometry,materials[provider],items.length), object = new THREE.Object3D();
      items.forEach(({feature,elevation}, index) => {
        const coordinate = maplibregl.MercatorCoordinate.fromLngLat(feature.geometry.coordinates);
        const scale = coordinate.meterInMercatorCoordinateUnits()/unit;
        object.position.set((coordinate.x-origin.x)/unit,(coordinate.y-origin.y)/unit,elevation*scale);
        object.scale.set(scale,scale,towerHeight(feature.properties.records)*scale); object.updateMatrix(); mesh.setMatrixAt(index,object.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; scene.add(mesh); meshes.push(mesh);
    }
    map.triggerRepaint();
  }
  return {
    id:'network-structures-3d', type:'custom', renderingMode:'3d',
    onAdd(mapInstance,gl) { scene = new THREE.Scene(); camera = new THREE.Camera(); renderer = new THREE.WebGLRenderer({canvas:mapInstance.getCanvas(),context:gl,antialias:true}); renderer.autoClear = false; },
    render(gl,args) {
      if (!meshes.length) return;
      const local = new THREE.Matrix4().makeTranslation(origin.x,origin.y,0).scale(new THREE.Vector3(unit,unit,unit));
      camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(local);
      renderer.resetState(); renderer.setViewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight); renderer.render(scene,camera);
    },
    setData(value) { features = value.filter(feature=>validTelusSite(feature) || validBellOutdoorSite(feature)); signature = null; refresh(); },
    setVisible(value) { visible = value; refresh(); map.triggerRepaint(); },
    refresh,
    onRemove() { clear(); geometry.dispose(); Object.values(materials).forEach(material=>material.dispose()); renderer?.dispose(); scene = null; }
  };
}
