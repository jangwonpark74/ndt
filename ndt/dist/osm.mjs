export const CENTER = { lat: 43.6456015, lon: -79.3868615 };
export function project(point) {
  return [(point.lon - CENTER.lon) * 111320 * Math.cos(CENTER.lat * Math.PI / 180), (CENTER.lat - point.lat) * 111320];
}
export function meters(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|')?$/i);
  if (!match) return null;
  const n = Number(match[1]);
  return /^(ft|feet|')$/i.test(match[2] || '') ? n * 0.3048 : n;
}
export function buildingHeight(tags, id) {
  const height = meters(tags.height);
  if (height !== null && height > 0) return { value: height, source: 'OSM height' };
  const levels = Number(tags['building:levels']);
  if (Number.isFinite(levels) && levels > 0) return { value: levels * 3, source: 'Estimated from OSM levels' };
  return { value: 9 + (Number(id) % 4) * 3, source: 'Estimated; no height tag' };
}
export function inPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.lat > point.lat) !== (b.lat > point.lat) && point.lon < (b.lon - a.lon) * (point.lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}
export function displayBuildings(elements) {
  const ways = elements.filter(e => e.type === 'way' && e.geometry?.length >= 4 && (e.tags?.building && e.tags.building !== 'no' || e.tags?.['building:part'] && e.tags['building:part'] !== 'no'));
  const parts = ways.filter(e => e.tags['building:part'] && e.tags['building:part'] !== 'no');
  // shortcut: suppress an outline when any part begins inside it; upgrade to polygon subtraction for incomplete or overlapping parts.
  return ways.filter(e => (e.tags['building:part'] && e.tags['building:part'] !== 'no') || !parts.some(part => inPolygon(part.geometry[0], e.geometry)));
}
