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
