import * as THREE from './vendor/three.module.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { roofGeometry } from './roof-geometry.mjs';
import { meters } from './osm.mjs';
import { addSceneLights, setSceneLight } from './lighting.mjs';

const ORIGIN = [-79.39, 43.70];
const MIN_ZOOM = 15;
const colors = {brick:'#ad8271',stone:'#b9b5a7',tiles:'#b77f70',glass:'#a8c3cc',concrete:'#c4c3bb',metal:'#aab5b7',wood:'#aa896b'};
// These suffixes were checked against the current OpenFreeMap Toronto tile.
export const roofFeatureIds = roof => roof.type === 'relation' ? [roof.id * 10 + 3] : [roof.id * 10, roof.id * 10 + 2];
function colour(value, material, fallback) {
  const candidate = (value || colors[String(material || '').toLowerCase()] || fallback).toLowerCase();
  return /^#[\da-f]{3}([\da-f]{3})?$/i.test(candidate) || Object.hasOwn(THREE.Color.NAMES, candidate)
    ? new THREE.Color(candidate) : new THREE.Color(fallback);
}
function prepare(geometry, color, elevation) {
  if (!geometry.getAttribute('position')?.count) { geometry.dispose(); return null; }
  if (geometry.index) { const original = geometry; geometry = original.toNonIndexed(); original.dispose(); }
  for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal'].includes(name)) geometry.deleteAttribute(name);
  const count = geometry.getAttribute('position').count;
  const rgb = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { rgb[i*3] = color.r; rgb[i*3+1] = color.g; rgb[i*3+2] = color.b; }
  geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  geometry.translate(0, 0, elevation);
  return geometry;
}

export function buildRoofParts(roof, properties, elevation, toLocal) {
  if (roof.polygons) {
    const results = [];
    for (const rings of roof.polygons) {
      const result = buildRoofParts({...roof, polygons:undefined, ring:rings[0], holes:rings.slice(1)}, properties, elevation, toLocal);
      if (!result) { results.flatMap(item => item.parts).forEach(part => part.dispose()); return null; }
      results.push(result);
    }
    return results.length ? {parts:results.flatMap(item => item.parts), replaceNative:results.every(item => item.replaceNative)} : null;
  }
  const tags = roof.tags;
  const base = Math.max(0, meters(tags.min_height) ?? (Number(properties.render_min_height) || Number(tags['building:min_level']) * 3 || 0));
  const height = meters(tags.height) ?? (Number(properties.render_height) || Number(tags['building:levels']) * 3 || 0);
  if (!(height > base)) return null;
  const shape = new THREE.Shape();
  roof.ring.forEach((point, i) => {const [x,y] = toLocal(point); if (i) shape.lineTo(x,y); else shape.moveTo(x,y);});
  shape.closePath();
  for (const ring of roof.holes || []) {
    const hole = new THREE.Path();
    ring.forEach((point, i) => {const [x,y] = toLocal(point); if (i) hole.lineTo(x,y); else hole.moveTo(x,y);});
    hole.closePath(); shape.holes.push(hole);
  }
  const roofColor = colour(tags['roof:colour'], tags['roof:material'], '#c8c9c1');
  if (roof.shape === 'flat') {
    const nativeHeight = Number(properties.render_height);
    if (!(nativeHeight > base)) return null;
    const flat = prepare(new THREE.ShapeGeometry(shape), roofColor, elevation + nativeHeight + 0.15);
    return flat ? {parts:[flat], replaceNative:false} : null;
  }
  const props = {roof_shape:roof.shape, roof_height:meters(tags['roof:height']), roof_levels:tags['roof:levels'], roof_angle:tags['roof:angle'], roof_direction:tags['roof:direction'], roof_orientation:tags['roof:orientation']};
  const pitched = roofGeometry([roof.ring, ...(roof.holes || [])], props, base, height, toLocal);
  if (!pitched) return null;
  const body = new THREE.ExtrudeGeometry(shape, {depth:Math.max(0, pitched.eaves-base), bevelEnabled:false, curveSegments:1});
  body.translate(0, 0, base);
  const wallColor = colour(tags['building:colour'], tags['building:material'], '#d8d9d3');
  const parts = [];
  for (const [geometry, color] of [[body,wallColor],[pitched.wall,wallColor],[pitched.roof,roofColor]]) {
    const part = prepare(geometry, color, elevation); if (part) parts.push(part);
  }
  return parts.length ? {parts, replaceNative:true} : null;
}

export function createRoofLayer(map, report, base = '.', center = ORIGIN, roofFile = 'toronto-roofs.json') {
  const origin = maplibregl.MercatorCoordinate.fromLngLat(center);
  const unit = origin.meterInMercatorCoordinateUnits();
  const toLocal = point => {
    const p = maplibregl.MercatorCoordinate.fromLngLat(point);
    return [(p.x-origin.x)/unit, (p.y-origin.y)/unit];
  };
  let renderer, camera, scene, light, mesh, data, request, failed = false, visible = true, signature = null, applied = new Set();
  const state = (id, active) => {
    if (!map.getSource('openmaptiles')) return;
    const target = {source:'openmaptiles', sourceLayer:'building', id};
    if (active) map.setFeatureState(target, {osm_roof:true});
    else map.removeFeatureState(target, 'osm_roof');
  };
  function clear() {
    for (const id of applied) state(id, false);
    applied.clear();
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; }
    signature = null;
  }
  async function load() {
    if (request || data || failed) return;
    report('Loading mapped roof shapes…');
    request = fetch(`${base}/${roofFile}`).then(response => {
      if (!response.ok) throw new Error(`Roof data: ${response.status}`);
      return response.json();
    }).then(json => {
      if (!Array.isArray(json.roofs)) throw new Error('Invalid roof data');
      data = new Map(json.roofs.flatMap(roof => roofFeatureIds(roof).map(id => [id, roof])));
      request = null; refresh();
    }).catch(error => { request = null; failed = true; report('Roof data unavailable; flat buildings remain visible.'); console.warn(error); });
  }
  function refresh() {
    if (!scene) return;
    if (!visible || map.getZoom() < MIN_ZOOM) {
      if (applied.size || mesh) clear();
      report(visible ? 'Zoom in to see mapped roof shapes.' : 'Buildings are hidden.');
      return;
    }
    if (!data) {
      if (failed) report('Roof data unavailable; flat buildings remain visible.');
      else load();
      return;
    }
    const bounds = map.getBounds(), candidates = new Map(), claims = new Map(), ambiguous = new Set();
    for (const feature of map.querySourceFeatures('openmaptiles', {sourceLayer:'building'})) {
      const roof = data.get(feature.id);
      if (!roof || feature.properties?.hide_3d || candidates.has(feature.id)) continue;
      const point = roof.ring?.[0] || roof.polygons?.[0]?.[0]?.[0];
      if (!point) continue;
      if (!bounds.contains(point)) continue;
      const elevation = map.getTerrain() ? map.queryTerrainElevation(point) : 0;
      if (!Number.isFinite(elevation)) continue;
      const key = `${roof.type || 'way'}:${roof.id}`;
      if (ambiguous.has(key)) continue;
      if (claims.has(key) && claims.get(key) !== feature.id) {
        candidates.delete(claims.get(key)); ambiguous.add(key); continue;
      }
      claims.set(key, feature.id);
      candidates.set(feature.id, {roof, properties:feature.properties || {}, elevation});
    }
    const next = [...candidates].map(([id, item]) => `${id}:${Math.round(item.elevation * 10)}`).sort().join(',');
    if (signature === next) return;
    const parts = [], included = new Set();
    let shown = 0;
    for (const [id, {roof, properties, elevation}] of candidates) {
      const result = buildRoofParts(roof, properties, elevation, toLocal);
      if (!result) continue;
      parts.push(...result.parts);
      if (result.replaceNative) included.add(id);
      shown++;
    }
    // Keep the original building until the replacement geometry is ready.
    const merged = parts.length ? mergeGeometries(parts) : null;
    for (const part of parts) part.dispose();
    if (parts.length && !merged) { report('Roof geometry could not be prepared; flat buildings remain visible.'); return; }
    clear(); signature = next;
    if (merged) {
      mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({vertexColors:true, side:THREE.DoubleSide}));
      mesh.frustumCulled = false; scene.add(mesh);
      for (const id of included) { state(id, true); applied.add(id); }
    }
    report(`${shown.toLocaleString()} mapped roofs in this view.`);
    map.triggerRepaint();
  }
  return {
    id:'osm-roofs', type:'custom', renderingMode:'3d',
    onAdd(mapInstance, gl) {
      camera = new THREE.Camera(); scene = new THREE.Scene();
      light = addSceneLights(scene);
      renderer = new THREE.WebGLRenderer({canvas:mapInstance.getCanvas(),context:gl,antialias:true}); renderer.autoClear = false;
    },
    render(gl, args) {
      if (!mesh) return;
      const local = new THREE.Matrix4().makeTranslation(origin.x,origin.y,0).scale(new THREE.Vector3(unit,unit,unit));
      camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(local);
      renderer.resetState(); renderer.setViewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight); renderer.render(scene,camera);
    },
    refresh,
    setLighting(preset) { if (light) setSceneLight(light, preset); },
    setVisible(value) { visible = value; if (value) failed = false; refresh(); },
    onRemove() { clear(); renderer?.dispose(); }
  };
}
