import { coverageRadius, RADIO_DEFAULTS } from './radio-model.mjs';

export function antennaPattern(record) {
  return record?.tx_ant_omni_indicator === 'N' ? 'omni' : record?.tx_ant_omni_indicator === 'D' ? 'directional' : 'unknown';
}

export function sitePattern(records) {
  if (!Array.isArray(records) || !records.length) return 'unknown';
  const patterns = new Set(records.map(antennaPattern));
  return patterns.size === 1 ? [...patterns][0] : 'mixed';
}

export function sitesWithFansOrIndoor(sites, fans) {
  const fanSites = new Set(fans.features.map(fan=>fan.properties.site_id));
  return sites.filter(site=>site.properties.records.some(record=>record.site_type === 'I') || fanSites.has(site.properties.site_id));
}

export function siteMatchesQuery(feature, query) {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return true;
  const p = feature.properties;
  const values = [p.site_id, p.provider, ...p.licensees, ...(p.locations || []), ...(p.ised_site_ids || []),
    ...feature.geometry.coordinates.map(value=>String(value)),
    ...p.records.flatMap(record=>[record.location,record.record_id,record.cell_id])];
  return values.some(value=>typeof value === 'string' && value.toLocaleLowerCase().includes(term));
}

export function sectorAzimuth(record) {
  if (antennaPattern(record) !== 'directional') return null;
  const value = typeof record.tx_ant_azimuth === 'string' ? record.tx_ant_azimuth.trim() : '';
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const degrees = Number(value);
  return degrees >= 0 && degrees < 360 ? degrees : null;
}

export function bearingSummaries(records) {
  const grouped = new Map();
  for (const record of records) {
    const azimuth = sectorAzimuth(record);
    if (azimuth === null) continue;
    if (!grouped.has(azimuth)) grouped.set(azimuth,{azimuth,count:0,technologies:new Set(),frequencies:new Set(),beamwidths:new Set()});
    const group = grouped.get(azimuth);
    group.count += record.record_count ?? 1;
    for (const value of record.technologies || (record.technology ? [record.technology] : [])) group.technologies.add(value);
    for (const value of record.frequencies || (record.tx_frequency ? [record.tx_frequency] : [])) group.frequencies.add(value);
    for (const value of record.beamwidths || (record.tx_ant_horiz_beamwidth ? [record.tx_ant_horiz_beamwidth] : [])) group.beamwidths.add(value);
  }
  return [...grouped.values()].sort((a,b)=>a.azimuth-b.azimuth).map(group=>({...group,technologies:[...group.technologies].sort(),frequencies:[...group.frequencies].sort((a,b)=>Number(a)-Number(b)),beamwidths:[...group.beamwidths].sort((a,b)=>Number(a)-Number(b))}));
}

export function sectorFeatures(sites) {
  const features = [], seen = new Set();
  for (const site of sites) {
    for (const {azimuth} of bearingSummaries(site.properties.records)) {
      const key = `${site.properties.site_id}:${azimuth}`;
      if (seen.has(key)) continue;
      seen.add(key);
      features.push({type:'Feature',geometry:site.geometry,properties:{site_id:site.properties.site_id,azimuth,provider:site.properties.provider === 'Bell' ? 'Bell' : 'TELUS'}});
    }
  }
  return {type:'FeatureCollection',features};
}

const EARTH_RADIUS_M = 6371000;
function destination(coordinates, distance, bearing) {
  const [lon,lat] = coordinates.map(value=>value*Math.PI/180), angle = bearing*Math.PI/180, arc = distance/EARTH_RADIUS_M;
  const nextLat = Math.asin(Math.sin(lat)*Math.cos(arc)+Math.cos(lat)*Math.sin(arc)*Math.cos(angle));
  const nextLon = lon+Math.atan2(Math.sin(angle)*Math.sin(arc)*Math.cos(lat),Math.cos(arc)-Math.sin(lat)*Math.sin(nextLat));
  return [nextLon*180/Math.PI,nextLat*180/Math.PI];
}

export function lowestFrequencyMHz(bearing) {
  const values = bearing.frequencies.filter(value=>/^\d+(?:\.\d+)?$/.test(value)).map(Number).filter(value=>value>=500 && value<=100000);
  return values.length ? Math.min(...values) : null;
}

// Planning preview only: a uniform boresight path-loss threshold, not measured coverage.
export function sectorFanFeatures(sites, scenario = RADIO_DEFAULTS, {includeOtherBearingCounts = false, fullCoverage = false} = {}) {
  const features = [];
  for (const site of sites) {
    if (site.properties.provider !== 'Bell') continue;
    const bearings = bearingSummaries(site.properties.records);
    if (!bearings.length || (!includeOtherBearingCounts && bearings.length !== 3)) continue;
    const reportedWidths = bearings.map(bearing => bearing.beamwidths.filter(value=>/^\d+(?:\.\d+)?$/.test(value)).map(Number).filter(value=>value>0 && value<360));
    if (!includeOtherBearingCounts && reportedWidths.some(widths=>!widths.length)) continue;
    bearings.forEach((bearing,index) => {
      if (!reportedWidths[index].length) return;
      const width = Math.max(...reportedWidths[index]), displayWidth = Math.max(15,width);
      const frequencyMHz = lowestFrequencyMHz(bearing), estimate = coverageRadius(frequencyMHz,scenario);
      if (!estimate || estimate.radiusM <= 0) return;
      // Scale the geometry for visualization only; retain the original model estimate in radius_m.
      const center = site.geometry.coordinates, displayRadiusM = estimate.radiusM * 5 / 12;
      const geometryRadius = fullCoverage ? estimate.radiusM : displayRadiusM, geometryWidth = fullCoverage ? width : displayWidth;
      const steps = Math.max(4,Math.ceil(geometryWidth/10));
      const ring = [center];
      for (let i=0;i<=steps;i++) ring.push(destination(center,geometryRadius,bearing.azimuth-geometryWidth/2+geometryWidth*i/steps));
      ring.push(center);
      features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},properties:{site_id:site.properties.site_id,azimuth:bearing.azimuth,beamwidth:width,display_width:displayWidth,sector:index%3+1,frequency_mhz:frequencyMHz,radius_m:estimate.radiusM,display_radius_m:displayRadiusM,status:estimate.status}});
    });
  }
  return {type:'FeatureCollection',features};
}
