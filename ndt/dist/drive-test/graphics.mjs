import {ALERT_COLOR, elapsed, FIX, fmt, observationColor, RAT_COLOR, traceGeometry} from './test-model.mjs';

export const CHART_PAD = {left: 46, right: 15, top: 12, bottom: 24};
const COLORS = {water: '#c6e0e9', park: '#dbe9d7', building: '#d8dfe1', rail: '#acb6bd', street: '#fff', arterial: '#fff'};
const ROAD_LABELS = new Set(['Bremner Boulevard', 'Front Street West', 'York Street', 'Spadina Avenue', 'Lake Shore Boulevard West', 'Lower Simcoe Street', 'Blue Jays Way', 'Wellington Street West']);
const projectY = latitude => Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, latitude)) * Math.PI / 360)) * 180 / Math.PI;
const relative = (longitude, anchor) => ((longitude - anchor + 540) % 360) - 180;

export function setupCanvas(canvas, width, height, density = window.devicePixelRatio || 1) {
  canvas.width = Math.ceil(width * density);
  canvas.height = Math.ceil(height * density);
  const ctx = canvas.getContext('2d');
  ctx.scale(density, density);
  return ctx;
}

export function extent(rows) {
  const anchor = rows.find(FIX)?.longitude ?? -79.39;
  let left = Infinity, right = -Infinity, low = Infinity, high = -Infinity;
  for (const row of rows) {
    if (!FIX(row)) continue;
    const x = relative(row.longitude, anchor), y = projectY(row.latitude);
    left = Math.min(left, x); right = Math.max(right, x);
    low = Math.min(low, y); high = Math.max(high, y);
  }
  return {anchor, left, right, low, high};
}

export function drawRoute(ctx, width, height, {rows, snapshot, metric, limits, gap, events = [], view = {zoom: 1, x: 0, y: 0}}) {
  const {anchor, left, right, low, high} = extent(rows);
  ctx.fillStyle = snapshot ? '#e8edeb' : '#edf3f6';
  ctx.fillRect(0, 0, width, height);
  if (!Number.isFinite(left)) {
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#52677d';
    ctx.textAlign = 'center';
    ctx.fillText('No GPS fixes for the selected observations', width / 2, height / 2);
    return {project: () => null, scale: ''};
  }
  const padding = Math.min(45, width / 8, height / 7);
  const factor = Math.min((width - 2 * padding) / Math.max(right - left, .0018),
    (height - 2 * padding) / Math.max(high - low, .0018)) * view.zoom;
  const point = ([lng, lat]) => [width / 2 + view.x + (relative(lng, anchor) - (right + left) / 2) * factor,
    height / 2 + view.y - (projectY(lat) - (low + high) / 2) * factor];
  const project = row => FIX(row) ? point([row.longitude, row.latitude]) : null;
  const path = (points, convert = point) => {
    ctx.beginPath();
    points.forEach((p, index) => index ? ctx.lineTo(...convert(p)) : ctx.moveTo(...convert(p)));
  };
  if (snapshot) {
    const layers = ['water', 'park', 'building', 'rail', 'street', 'arterial'];
    for (const kind of layers) {
      for (const {geometry, properties} of snapshot.features) {
        if (properties.kind !== kind) continue;
        if (geometry.type === 'Polygon') {
          path(geometry.coordinates[0]);
          ctx.closePath(); ctx.fillStyle = COLORS[kind]; ctx.fill();
        } else {
          path(geometry.coordinates);
          const lineWidth = kind === 'arterial' ? 4 : kind === 'street' ? 2.2 : 1;
          ctx.lineWidth = lineWidth + 1.1; ctx.strokeStyle = '#c4d0d4'; ctx.stroke();
          ctx.lineWidth = lineWidth; ctx.strokeStyle = COLORS[kind]; ctx.stroke();
        }
      }
    }
    const placed = [];
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const roads = new Map();
    for (const {geometry, properties} of snapshot.features) {
      if (geometry.type !== 'LineString' || !ROAD_LABELS.has(properties.name)) continue;
      const points = geometry.coordinates;
      for (let i = 1; i < points.length; i++) {
        const a = point(points[i - 1]), b = point(points[i]);
        const length = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
        if (x < 48 || x > width - 48 || y < 16 || y > height - 16) continue;
        if (!roads.has(properties.name) || roads.get(properties.name).length < length) {
          roads.set(properties.name, {x, y, length, angle: Math.atan2(b[1] - a[1], b[0] - a[0])});
        }
      }
    }
    for (const [name, {x, y, angle}] of roads) {
      if (placed.some(([a, b]) => Math.abs(a - x) < 76 && Math.abs(b - y) < 23)) continue;
      placed.push([x, y]);
      ctx.save(); ctx.translate(x, y);
      ctx.rotate(Math.abs(angle) > Math.PI / 2 ? angle + Math.PI : angle);
      ctx.lineWidth = 3; ctx.strokeStyle = '#f6f8f7'; ctx.strokeText(name, 0, 0);
      ctx.fillStyle = '#465c6c'; ctx.fillText(name, 0, 0);
      ctx.restore();
    }
  } else {
    ctx.strokeStyle = '#d6e1e8'; ctx.lineWidth = 1;
    for (let x = width % 48 / 2; x < width; x += 48) path([[x, 0], [x, height]], p => p), ctx.stroke();
    for (let y = height % 48 / 2; y < height; y += 48) path([[0, y], [width, y]], p => p), ctx.stroke();
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const {segments} = traceGeometry(rows, gap * 1000);
  for (const segment of segments) {
    path(segment, project); ctx.lineWidth = 6; ctx.strokeStyle = '#fff'; ctx.stroke();
    path(segment, project); ctx.lineWidth = 2.8; ctx.strokeStyle = '#6f8194'; ctx.stroke();
  }
  // Paint threshold failures last so dense passing samples cannot hide them.
  for (const alert of [false, true]) {
    for (const row of rows) {
      if (!FIX(row)) continue;
      const color = observationColor(row, metric, limits);
      if ((color === ALERT_COLOR) !== alert) continue;
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(...project(row), alert ? 3.5 : 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  for (const event of events) {
    if (!FIX(event.row) || event.kind === 'Threshold excursion') continue;
    const [x, y] = project(event.row);
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#243c53'; ctx.fillRect(-3, -3, 6, 6); ctx.strokeStyle = 'white'; ctx.lineWidth = 1;
    ctx.strokeRect(-3, -3, 6, 6); ctx.restore();
  }
  const first = segments[0]?.[0];
  const last = segments.at(-1)?.at(-1);
  for (const [text, row, offset] of [['START', first, -18], ['END', last, 18]]) {
    if (!row || (first === last && text === 'END')) continue;
    const [x, y] = project(row);
    ctx.fillStyle = '#fff'; ctx.fillRect(x - 20, y + offset - 6, 40, 12);
    ctx.fillStyle = '#29465d'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + offset);
  }
  const latitude = (first?.latitude + last?.latitude) / 2;
  const meterPerPixel = 111195 * Math.max(0.01, Math.cos(latitude * Math.PI / 180)) / factor;
  const ideal = meterPerPixel * Math.min(88, width / 5);
  const power = 10 ** Math.floor(Math.log10(ideal));
  const meters = [5, 2, 1].map(n => n * power).find(n => n <= ideal) || power;
  return {project, scale: meters >= 1000 ? `${fmt(meters / 1000, meters % 1000 ? 1 : 0)} km` : `${fmt(meters, meters < 1 ? 2 : 0)} m`, scaleWidth: meters / meterPerPixel};
}

export function marker(ctx, pixel) {
  if (!pixel) return;
  ctx.beginPath(); ctx.arc(...pixel, 7, 0, Math.PI * 2); ctx.fillStyle = '#142e46'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.beginPath(); ctx.arc(...pixel, 2, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
}

export function drawTimeline(ctx, width, height, state, rows, rats) {
  const {test, metric, limits, gap} = state, pad = CHART_PAD;
  const values = rows.filter(row => Number.isFinite(row[metric]));
  const x = t => pad.left + (t - test.start) / (test.end - test.start || 1) * (width - pad.left - pad.right);
  if (!values.length) {
    ctx.font = '12px sans-serif'; ctx.fillStyle = '#52677d'; ctx.textAlign = 'center';
    ctx.fillText('No values for the selected metric', width / 2, height / 2);
    return x;
  }
  let min = Math.min(...rats.map(rat => limits[rat])), max = Math.max(...rats.map(rat => limits[rat]));
  for (const row of values) { min = Math.min(min, row[metric]); max = Math.max(max, row[metric]); }
  const rawStep = Math.max(0.1, (max - min) / 3), power = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map(n => n * power).find(n => n >= rawStep);
  min = Math.floor((min - step * .12) / step) * step;
  max = Math.ceil((max + step * .12) / step) * step;
  const y = value => pad.top + (max - value) / (max - min) * (height - pad.top - pad.bottom);
  ctx.font = '10px sans-serif'; ctx.lineWidth = 1; ctx.textBaseline = 'middle';
  for (let value = min; value <= max + step * .01; value += step) {
    const yy = y(value);
    ctx.strokeStyle = '#e1e9ef'; ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(width - pad.right, yy); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillStyle = '#52677d'; ctx.fillText(fmt(value, Number.isInteger(step) ? 0 : step >= .5 ? 1 : 2), pad.left - 6, yy, pad.left - 9);
  }
  const ticks = width < 400 ? 3 : 5;
  for (let i = 0; i <= ticks; i++) {
    const t = Math.round((test.end - test.start) * i / ticks);
    if (test.start === test.end && i > 0) break;
    ctx.fillStyle = '#52677d'; ctx.textAlign = i === ticks ? 'right' : i === 0 ? 'left' : 'center';
    ctx.fillText(elapsed(t, test.end - test.start < 5000), x(test.start + t), height - 8);
  }
  ctx.setLineDash([4, 4]);
  for (const limit of new Set(rats.map(rat => limits[rat]))) {
    ctx.strokeStyle = ALERT_COLOR; ctx.beginPath(); ctx.moveTo(pad.left, y(limit)); ctx.lineTo(width - pad.right, y(limit)); ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const rat of rats) {
    let previous;
    ctx.strokeStyle = RAT_COLOR[rat]; ctx.fillStyle = RAT_COLOR[rat]; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const row of rows) {
      if (row.rat !== rat) continue;
      if (!Number.isFinite(row[metric])) { previous = null; continue; }
      const a = x(row.t), b = y(row[metric]);
      if (previous && row.t - previous.t <= gap * 1000) ctx.lineTo(a, b);
      else {
        ctx.fillRect(a - 1.25, b - 1.25, 2.5, 2.5);
        ctx.moveTo(a, b);
      }
      previous = row;
    }
    ctx.stroke();
  }
  return x;
}

export function drawCDF(ctx, width, height, vm) {
  const rats = vm.rat === 'all' ? ['LTE', 'NR'] : [vm.rat];
  const series = rats.flatMap(rat => [{rat, baseline: false, rows: vm.analysis.byRat[rat].series},
    ...(vm.baseline ? [{rat, baseline: true, rows: vm.baselineAnalysis.byRat[rat].series}] : [])])
    .map(s => ({...s, values: s.rows.map(r => r[vm.metric]).filter(Number.isFinite).sort((a, b) => a - b)}));
  const available = series.filter(s => s.values.length);
  ctx.font = '11px sans-serif'; ctx.fillStyle = '#52677d';
  if (!available.length) { ctx.fillText('No valid observations for this metric.', 16, 30); return; }
  let low = Math.min(...available.map(s => s.values[0])), high = Math.max(...available.map(s => s.values.at(-1)));
  if (low === high) { low--; high++; }
  const pad = {left: 48, right: 22, top: 18, bottom: 32};
  const x = n => pad.left + (n - low) / (high - low) * (width - pad.left - pad.right);
  const y = p => height - pad.bottom - p * (height - pad.top - pad.bottom);
  for (let i = 0; i <= 4; i++) {
    ctx.strokeStyle = '#e1e9ef'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(pad.left, y(i / 4)); ctx.lineTo(width - pad.right, y(i / 4)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillStyle = '#52677d'; ctx.fillText(`${i * 25}%`, pad.left - 8, y(i / 4) + 3);
    ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
    ctx.fillText(fmt(low + (high - low) * i / 4), x(low + (high - low) * i / 4), height - 10);
  }
  for (const {rat, baseline, values} of available) {
    ctx.strokeStyle = RAT_COLOR[rat]; ctx.lineWidth = baseline ? 1.8 : 2.2; ctx.setLineDash(baseline ? [5, 4] : []);
    ctx.beginPath(); ctx.moveTo(pad.left, y(0));
    for (let i = 0; i < values.length;) {
      const value = values[i], before = i;
      while (i < values.length && values[i] === value) i++;
      ctx.lineTo(x(value), y(before / values.length));
      ctx.lineTo(x(value), y(i / values.length));
    }
    ctx.lineTo(width - pad.right, y(1)); ctx.stroke();
  }
  ctx.setLineDash([]);
}
