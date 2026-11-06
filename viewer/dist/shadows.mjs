// Project footprints away from the light. These are illustrative,
// ground-draped shadows; they do not model terrain occlusion or time of day.
export function shadowFeatures(features, limit = 1500, direction = [1,1,3]) {
  const result = [];
  if (!Array.isArray(direction) || direction.length !== 3 || !direction.every(Number.isFinite) || direction[2] <= 0) return {type:'FeatureCollection', features:result};
  let count = 0;
  for (const feature of features) {
    const height = Number(feature.properties?.render_height);
    if (!Number.isFinite(height) || height <= 0 || feature.properties?.hide_3d) continue;
    const geometry = feature.geometry;
    const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
    for (const polygon of polygons) {
      const ring = polygon?.[0];
      if (!Array.isArray(ring) || ring.length < 4 || !ring.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) < 85)) continue;
      if (++count > limit) return {type:'FeatureCollection', features:result};
      const scale = Math.min(height, 150) / direction[2];
      const latitude = ring[0][1] * Math.PI / 180;
      const dx = -direction[0] * scale / (111320 * Math.cos(latitude)), dy = direction[1] * scale / 111320;
      const shift = p => [p[0] + dx, p[1] + dy];
      const add = coordinates => result.push({type:'Feature', properties:{}, geometry:{type:'Polygon', coordinates:[coordinates]}});
      add(ring.map(shift));
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i+1];
        add([a, b, shift(b), shift(a), a]);
      }
    }
  }
  return {type:'FeatureCollection', features:result};
}
