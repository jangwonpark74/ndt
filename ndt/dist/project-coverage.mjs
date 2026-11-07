import {sectorFanFeatures} from './network-symbols.mjs?v=network-explorer-4';
import {RADIO_DEFAULTS} from './radio-model.mjs';

const SITE_COUNT = 7, EARTH_RADIUS_M = 6371000;
export function distanceMetres(a, b) {
  const lat1 = a[1]*Math.PI/180, lat2 = b[1]*Math.PI/180;
  const dlat = lat2-lat1, dlon = (b[0]-a[0])*Math.PI/180;
  const h = Math.sin(dlat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)**2;
  return 2*EARTH_RADIUS_M*Math.asin(Math.min(1,Math.sqrt(h)));
}
function nearest(a, b, center) {
  return distanceMetres(a.geometry.coordinates,center)-distanceMetres(b.geometry.coordinates,center) || a.properties.site_id.localeCompare(b.properties.site_id);
}

export function selectProjectSites(sites, center) {
  const fans = sectorFanFeatures(sites, RADIO_DEFAULTS).features, counts = new Map();
  for (const fan of fans) counts.set(fan.properties.site_id, (counts.get(fan.properties.site_id) || 0) + 1);
  const eligible = sites.filter(site=>counts.get(site.properties.site_id) === 3).sort((a,b)=>nearest(a,b,center));
  if (!eligible.length) return [];
  const anchor = eligible[0];
  return [anchor, ...eligible.slice(1).sort((a,b)=>nearest(a,b,anchor.geometry.coordinates)).slice(0,SITE_COUNT-1)];
}

function convexHull(points) {
  const sorted = points.map(point=>point.slice()).sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
  const unique = sorted.filter((p,i)=>!i || p[0] !== sorted[i-1][0] || p[1] !== sorted[i-1][1]);
  if (unique.length < 3) return null;
  const cross = (a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  function half(items) {
    const result = [];
    for (const point of items) {
      while (result.length >= 2 && cross(result.at(-2),result.at(-1),point) <= 0) result.pop();
      result.push(point);
    }
    return result;
  }
  const lower = half(unique), upper = half([...unique].reverse());
  lower.pop(); upper.pop();
  const ring = lower.concat(upper);
  if (ring.length < 3) return null;
  ring.push(ring[0]); return ring;
}

export function projectCoverage(sites, scenario) {
  if (!sites.length || new Set(sites.map(site=>site.properties.site_id)).size !== sites.length) return null;
  const fans = sectorFanFeatures(sites, scenario, {fullCoverage:true}).features;
  const counts = new Map();
  for (const fan of fans) counts.set(fan.properties.site_id,(counts.get(fan.properties.site_id) || 0)+1);
  if (sites.some(site=>counts.get(site.properties.site_id) !== 3)) return null;
  const ring = convexHull(fans.flatMap(fan=>fan.geometry.coordinates[0]));
  return ring ? {type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},properties:{site_count:sites.length}} : null;
}
