import * as THREE from './vendor/three.module.js';
import { TREE_MIN_ZOOM, treeSize, visibleTreeTiles, canopyDetail } from './tree-data.mjs';
import { addSceneLights, setSceneLight } from './lighting.mjs';

const ORIGIN = [-79.39, 43.70];
const MAX_CACHED_TILES = 48;
const MAX_REQUESTS = 8;

export function createTreeLayer(map, report, base = '.', center = ORIGIN) {
  const origin = maplibregl.MercatorCoordinate.fromLngLat(center);
  const unit = origin.meterInMercatorCoordinateUnits();
  let renderer, scene, camera, light, manifest, manifestRequest, manifestFailed = false, visible = true, signature = null;
  const cache = new Map(), pending = new Map(), failed = new Set();
  let activeKeys = new Set();
  let meshes = [];
  const trunkGeometry = new THREE.CylinderGeometry(1,1,1,6).rotateX(Math.PI/2);
  const broadGeometry = new THREE.SphereGeometry(1,8,6);
  const needleGeometry = new THREE.ConeGeometry(1,1,8).rotateX(Math.PI/2);
  const bark = new THREE.MeshLambertMaterial({color:'#77604a'});
  const foliage = new THREE.MeshLambertMaterial({color:'#ffffff'});
  function clear() {
    for (const mesh of meshes) { scene.remove(mesh); mesh.dispose(); }
    meshes = []; signature = null;
  }
  function loadManifest() {
    if (manifestRequest || manifest || manifestFailed) return;
    report('Loading OSM trees…');
    manifestRequest = fetch(`${base}/trees/manifest.json`).then(response => {
      if (!response.ok) throw new Error(`Tree manifest: ${response.status}`);
      return response.json();
    }).then(data => {
      if (!data.tiles || data.zoom !== 14) throw new Error('Invalid tree manifest');
      manifest = data; manifestRequest = null; refresh();
    }).catch(error => { manifestRequest = null; manifestFailed = true; report('Tree data unavailable.'); console.warn(error); });
  }
  function loadTile(key) {
    if (cache.has(key) || pending.has(key) || failed.has(key)) return;
    const promise = fetch(`${base}/trees/${key}.json`).then(response => {
      if (!response.ok) throw new Error(`Tree tile ${key}: ${response.status}`);
      return response.json();
    }).then(data => {
      if (!Array.isArray(data)) throw new Error(`Invalid tree tile: ${key}`);
      cache.set(key, data);
      while (cache.size > MAX_CACHED_TILES) {
        const unused = [...cache.keys()].find(candidate => !activeKeys.has(candidate));
        if (!unused) break;
        cache.delete(unused);
      }
    }).catch(error => { failed.add(key); console.warn(error); }).finally(() => { pending.delete(key); refresh(); });
    pending.set(key, promise);
  }
  function addMesh(geometry, material, trees, kind) {
    if (!trees.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, trees.length);
    const transform = new THREE.Object3D(), color = new THREE.Color();
    for (let i=0;i<trees.length;i++) {
      const {record, elevation, size, detail} = trees[i];
      const coordinate = maplibregl.MercatorCoordinate.fromLngLat([record[0],record[1]]);
      const x=(coordinate.x-origin.x)/unit, y=(coordinate.y-origin.y)/unit;
      const h=size.height, d=size.diameter;
      const shade = Math.abs(Math.sin(record[0]*623.41 + record[1]*941.71));
      if (kind === 'trunk') {
        transform.position.set(x,y,elevation+h*.22); transform.scale.set(Math.max(.12,d*.045),Math.max(.12,d*.045),h*.44);
      } else {
        const lobe = kind === 'lobe';
        transform.position.set(x+(lobe ? d*.15 : 0),y+(lobe ? d*(shade-.5)*.25 : 0),elevation+(kind === 'needle' ? h*.64 : h*(lobe ? .77 : .70)));
        transform.scale.set(d*(lobe ? .30*detail : .5),d*(lobe ? .30*detail : .5),kind === 'needle' ? h*.72 : h*(lobe ? .22*detail : .26 + shade*.08));
        color.setHSL(.29 + shade*.035,.36 + shade*.12,.25 + shade*.10); mesh.setColorAt(i,color);
      }
      transform.updateMatrix(); mesh.setMatrixAt(i,transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false; scene.add(mesh); meshes.push(mesh);
  }
  function refresh() {
    if (!scene) return;
    if (!visible || map.getZoom() < TREE_MIN_ZOOM) {
      if (meshes.length) clear();
      report(visible ? 'Zoom in for 3D trees.' : 'Trees are hidden.'); return;
    }
    if (!manifest) { if (manifestFailed) report('Tree data unavailable.'); else loadManifest(); return; }
    const bounds = map.getBounds(), center = map.getCenter();
    const keys = visibleTreeTiles(manifest,bounds);
    const n = 2 ** manifest.zoom;
    const centerX = (center.lng + 180) / 360 * n;
    const centerY = (1 - Math.asinh(Math.tan(center.lat * Math.PI / 180)) / Math.PI) / 2 * n;
    const distance = key => { const [x,y] = key.split('/').map(Number); return (x-centerX)**2+(y-centerY)**2; };
    keys.sort((a,b) => distance(a)-distance(b)); activeKeys = new Set(keys);
    for (const key of keys) { if (pending.size >= MAX_REQUESTS) break; loadTile(key); }
    if (keys.some(key => pending.has(key) || (!cache.has(key) && !failed.has(key)))) { report('Loading OSM trees…'); return; }
    const selected = [];
    let available = 0, unavailableTerrain = 0;
    for (const key of keys) {
      const tile = cache.get(key) || [];
      for (const record of tile) {
        if (!bounds.contains([record[0],record[1]])) continue;
        available++;
        const elevation = map.getTerrain() ? map.queryTerrainElevation([record[0],record[1]]) : 0;
        if (!Number.isFinite(elevation)) { unavailableTerrain++; continue; }
        selected.push({record,elevation,size:treeSize(record),detail:canopyDetail(record,center)});
      }
    }
    const next = `${keys.join(',')}|${selected.map(t=>`${t.record[0]}:${t.record[1]}:${Math.round(t.elevation)}:${Math.round(t.detail*20)}`).join(',')}|${map.getTerrain() ? 'terrain' : 'flat'}`;
    if (signature === next) return;
    clear(); signature = next;
    const broad = selected.filter(item=>!item.size.conifer), needle = selected.filter(item=>item.size.conifer);
    addMesh(trunkGeometry,bark,selected,'trunk'); addMesh(broadGeometry,foliage,broad,'broad'); addMesh(broadGeometry,foliage,broad.filter(item=>item.detail>0),'lobe'); addMesh(needleGeometry,foliage,needle,'needle');
    const partial = keys.some(key=>failed.has(key)) ? ' Some tree tiles unavailable.' : '';
    const pendingTerrain = unavailableTerrain ? ' Some elevations still loading.' : '';
    const detail = available > selected.length ? ` of ${available.toLocaleString()}` : '';
    report(`${selected.length.toLocaleString()}${detail} mapped and row trees in view.${partial}${pendingTerrain}`);
    map.triggerRepaint();
  }
  return {
    id:'osm-trees', type:'custom', renderingMode:'3d',
    onAdd(mapInstance,gl) {
      camera = new THREE.Camera(); scene = new THREE.Scene();
      light = addSceneLights(scene);
      renderer = new THREE.WebGLRenderer({canvas:mapInstance.getCanvas(),context:gl,antialias:true}); renderer.autoClear = false;
    },
    render(gl,args) {
      if (!meshes.length) return;
      const local = new THREE.Matrix4().makeTranslation(origin.x,origin.y,0).scale(new THREE.Vector3(unit,unit,unit));
      camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(local);
      renderer.resetState(); renderer.setViewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight); renderer.render(scene,camera);
    },
    refresh,
    setLighting(preset) { if (light) setSceneLight(light, preset); },
    setVisible(value) { visible=value; if (value) { failed.clear(); manifestFailed = false; } refresh(); },
    onRemove() { clear(); scene = null; trunkGeometry.dispose(); broadGeometry.dispose(); needleGeometry.dispose(); bark.dispose(); foliage.dispose(); renderer?.dispose(); }
  };
}
