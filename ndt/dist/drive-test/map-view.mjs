import {FIX, observationColor, traceGeometry} from './test-model.mjs';
import {drawRoute, marker, setupCanvas} from './graphics.mjs';

const EMPTY = {type: 'FeatureCollection', features: []};
const line = coordinates => ({type: 'Feature', geometry: {type: 'LineString', coordinates}, properties: {}});
const point = (coordinates, properties = {}) => ({type: 'Feature', geometry: {type: 'Point', coordinates}, properties});
const coord = row => [row.longitude, Math.max(-85, Math.min(85, row.latitude))];

export function makeMap(canvas, live, mode, status, attribution, scale, controls, onPick) {
  let rows = [], state, snapshot, scene, background, map, activeMode, pixelRatio, generation = 0;
  const view = {zoom: 1, x: 0, y: 0};
  const [zoomIn, zoomOut] = controls.querySelectorAll('button');
  let drag, drawFrame;
  const setStatus = text => { status.textContent = text; status.hidden = !text; };

  function fallback() {
    if (!state || !canvas.clientWidth) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    pixelRatio = window.devicePixelRatio || 1;
    const ctx = setupCanvas(canvas, width, height, pixelRatio);
    background = document.createElement('canvas');
    const backing = setupCanvas(background, width, height, pixelRatio);
    scene = drawRoute(backing, width, height, {
      rows, snapshot: mode.value === 'snapshot' ? snapshot : null, metric: state.metric,
      limits: state.limits, gap: state.gap, events: state.analysis.events.filter(event => state.rat === 'all' || event.row.rat === state.rat),
      view,
    });
    const planned=state.test?.context?.route?.coordinates;
    if(planned?.length){
      backing.save();backing.strokeStyle='#884b9c';backing.lineWidth=2;backing.setLineDash([6,5]);backing.beginPath();
      planned.forEach(([longitude,latitude],i)=>{const pixel=scene.project({longitude,latitude});if(pixel)i?backing.lineTo(...pixel):backing.moveTo(...pixel);});
      backing.stroke();backing.restore();
    }
    const hasTrace = Boolean(scene.scale);
    zoomIn.disabled = !hasTrace || view.zoom >= 8;
    zoomOut.disabled = !hasTrace || view.zoom <= .5;
    scale.hidden = !scene.scale;
    scale.textContent = scene.scale;
    scale.style.borderBottom = '1px solid #35586d';
    scale.style.minWidth = `${scene.scaleWidth || 0}px`;
    attribution.hidden = !snapshot || mode.value !== 'snapshot';
    ctx.drawImage(background, 0, 0, width, height);
    marker(ctx, scene.project(state.selected));
  }

  function cursor() {
    if (map && activeMode === 'live' && map.getSource('cursor')) {
      map.getSource('cursor').setData(FIX(state?.selected) ? point(coord(state.selected)) : EMPTY);
    } else if (scene && background && canvas.clientWidth) {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(background, 0, 0, canvas.clientWidth, canvas.clientHeight);
      marker(ctx, scene.project(state?.selected));
    }
  }

  function fit() {
    if (!map || activeMode !== 'live') {
      Object.assign(view, {zoom: 1, x: 0, y: 0});
      return fallback();
    }
    const bounds = new maplibregl.LngLatBounds();
    const anchor = rows.find(FIX)?.longitude;
    for (const row of rows) {
      if (FIX(row)) {
        const [lng, lat] = coord(row);
        bounds.extend([anchor + ((lng - anchor + 540) % 360) - 180, lat]);
      }
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, {padding: 40, maxZoom: 17, duration: 0});
  }

  function overlays() {
    const source = map?.getSource('observations');
    if (!source) return;
    const {segments} = traceGeometry(rows, state.gap * 1000);
    const planned=state.test?.context?.route?.coordinates;
    map.getSource('planned-route').setData(planned?line(planned):EMPTY);
    map.getSource('trace').setData({type: 'FeatureCollection', features: segments.filter(segment => segment.length >= 2)
      .map(segment => line(segment.map(coord)))});
    source.setData({type: 'FeatureCollection', features: rows.flatMap((row, i) => FIX(row) ?
      [point(coord(row), {index: i, color: observationColor(row, state.metric, state.limits)})] : [])});
    cursor();
  }

  function useFallback(text) {
    generation++;
    map?.remove();
    map = null;
    activeMode = 'fallback';
    canvas.hidden = false;
    controls.hidden = false;
    live.hidden = true;
    setStatus(text);
    fallback();
  }

  function setMode() {
    const version = ++generation;
    if (mode.value !== 'live') {
      useFallback(mode.value === 'snapshot' && !snapshot ? 'Toronto snapshot unavailable · showing trace' : '');
      return;
    }
    if (map && activeMode === 'live') {
      overlays(); fit(); return;
    }
    if (!window.maplibregl) return useFallback('Live map library unavailable · showing trace');
    live.hidden = false;
    controls.hidden = true;
    scale.hidden = true;
    attribution.hidden = true;
    setStatus('Loading live basemap…');
    try {
      const instance = new maplibregl.Map({container: live, style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [-79.39, 43.70], zoom: 10.2, maxPitch: 65, renderWorldCopies: true});
      map = instance;
      activeMode = 'loading';
      instance.addControl(new maplibregl.NavigationControl(), 'top-right');
      instance.addControl(new maplibregl.ScaleControl(), 'bottom-left');
      const timeout = setTimeout(() => {
        if (version === generation && activeMode === 'loading') useFallback('Live map timed out · showing trace');
      }, 10000);
      instance.once('load', () => {
        clearTimeout(timeout);
        if (version !== generation) return;
        instance.addSource('trace', {type: 'geojson', data: EMPTY});
        instance.addSource('planned-route', {type:'geojson',data:EMPTY});
        instance.addLayer({id:'planned-route',type:'line',source:'planned-route',paint:{'line-color':'#884b9c','line-width':3,'line-dasharray':[3,2]}});
        instance.addSource('observations', {type: 'geojson', data: EMPTY});
        instance.addSource('cursor', {type: 'geojson', data: EMPTY});
        instance.addLayer({id: 'trace', type: 'line', source: 'trace', paint: {'line-color': '#647a91', 'line-width': 3}});
        instance.addLayer({id: 'observations', type: 'circle', source: 'observations',
          paint: {'circle-color': ['get', 'color'], 'circle-radius': 3}});
        instance.addLayer({id: 'cursor', type: 'circle', source: 'cursor', paint: {
          'circle-color': '#142e46', 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2}});
        instance.on('click', 'observations', event => onPick(rows[event.features[0].properties.index]));
        activeMode = 'live';
        canvas.hidden = true;
        setStatus('');
        overlays(); fit();
      });
      instance.on('error', () => {
        if (version !== generation) return;
        if (activeMode === 'live') setStatus('Some basemap resources are unavailable');
      });
    } catch {
      useFallback('Live map requires WebGL · showing trace');
    }
  }

  new ResizeObserver(() => {
    if (activeMode === 'live') map.resize();
    else fallback();
  }).observe(canvas.parentElement);
  mode.addEventListener('change', setMode);
  function zoom(multiplier) {
    const next = Math.max(.5, Math.min(8, view.zoom * multiplier));
    view.x *= next / view.zoom;
    view.y *= next / view.zoom;
    view.zoom = next;
    fallback();
  }
  zoomIn.addEventListener('click', () => zoom(1.5));
  zoomOut.addEventListener('click', () => zoom(1 / 1.5));
  canvas.addEventListener('pointerdown', event => {
    if (!scene?.scale || event.button !== 0 || drag) return;
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY, startX: view.x, startY: view.y, moved: false};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    view.x = drag.startX + dx;
    view.y = drag.startY + dy;
    canvas.classList.add('panning');
    cancelAnimationFrame(drawFrame);
    drawFrame = requestAnimationFrame(fallback);
  });
  canvas.addEventListener('lostpointercapture', () => {
    drag = null;
    canvas.classList.remove('panning');
  });
  canvas.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId || drag.moved) return;
    const {left, top} = canvas.getBoundingClientRect();
    let closest, distance = 15;
    for (const row of rows) {
      const pixel = scene.project(row);
      if (!pixel) continue;
      const next = Math.hypot(pixel[0] - (event.clientX - left), pixel[1] - (event.clientY - top));
      if (next < distance) { distance = next; closest = row; }
    }
    if (closest) onPick(closest);
  });

  return {
    fit, cursor,
    snapshot(data) {
      snapshot = data;
      if (activeMode !== 'live' && mode.value === 'snapshot') {
        setStatus('');
        fallback();
      }
    },
    update(vm, isNew) {
      state = vm; rows = vm.series;
      if (isNew) {
        Object.assign(view, {zoom: 1, x: 0, y: 0});
        if(!['live','trace'].includes(mode.value))mode.value='trace';
        setMode();
      } else if (activeMode === 'live') overlays();
      else fallback();
    },
  };
}
