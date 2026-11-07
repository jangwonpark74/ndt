import assert from 'node:assert/strict';
import fs from 'node:fs';
import {distanceMetres, projectCoverage, selectProjectSites} from '../dist/project-coverage.mjs';
import {sectorFanFeatures} from '../dist/network-symbols.mjs';
import {RADIO_DEFAULTS} from '../dist/radio-model.mjs';

const sites = JSON.parse(fs.readFileSync(new URL('../dist/bell-outdoor-sites.geojson',import.meta.url),'utf8')).features;
const regions = JSON.parse(fs.readFileSync(new URL('../regions.json',import.meta.url),'utf8'));
const allFans = sectorFanFeatures(sites,RADIO_DEFAULTS).features, counts = new Map();
for (const fan of allFans) counts.set(fan.properties.site_id,(counts.get(fan.properties.site_id)||0)+1);
const eligible = sites.filter(site=>counts.get(site.properties.site_id) === 3);
function insideHull(point, ring) {
  return ring.slice(1).every((p,i)=>{
    const a = ring[i], cross = (p[0]-a[0])*(point[1]-a[1])-(p[1]-a[1])*(point[0]-a[0]);
    return cross >= -1e-12;
  });
}
for (const project of regions.find(r=>r.id === 'toronto').projects) {
  const selected = selectProjectSites(sites,project.center);
  assert.equal(selected.length,7,`${project.name} has seven eligible sites`);
  assert.equal(new Set(selected.map(f=>f.properties.site_id)).size,7);
  const anchor = selected[0].geometry.coordinates;
  assert.ok(eligible.every(site=>distanceMetres(anchor,project.center)<=distanceMetres(site.geometry.coordinates,project.center)+1e-6),'anchor is nearest to the project');
  const radius = Math.max(...selected.map(site=>distanceMetres(site.geometry.coordinates,anchor)));
  assert.ok(eligible.filter(site=>!selected.includes(site)).every(site=>distanceMetres(site.geometry.coordinates,anchor)>=radius-1e-6),'other six are nearest to the anchor');
  assert.ok(radius < 2500,`${project.name} forms a close cluster in the current snapshot`);
  const boundary = projectCoverage(selected,RADIO_DEFAULTS);
  assert.equal(boundary.geometry.type,'Polygon');
  assert.equal(boundary.geometry.coordinates.length,1,'each project has one boundary');
  assert.equal(boundary.properties.site_count,7);
  const ring = boundary.geometry.coordinates[0];
  const full = sectorFanFeatures(selected,RADIO_DEFAULTS,{fullCoverage:true}).features;
  const shown = sectorFanFeatures(selected,RADIO_DEFAULTS).features;
  assert.equal(full.length,21);
  for (const fan of full) for (const point of fan.geometry.coordinates[0]) assert.ok(insideHull(point,ring),'project area encloses each full-size sector');
  assert.ok(full.some((fan,index)=>JSON.stringify(fan.geometry) !== JSON.stringify(shown[index].geometry)),'boundary uses the original full-size sectors');
  assert.equal(projectCoverage(selected,{...RADIO_DEFAULTS,eirpDbm:NaN}),null,'invalid scenarios have no boundary');
}
const edited = selectProjectSites(sites,regions[0].projects[0].center).slice(0,6);
assert.equal(projectCoverage(edited,RADIO_DEFAULTS).properties.site_count,6,'edited projects use their actual site count');
assert.equal(projectCoverage([],RADIO_DEFAULTS),null,'an empty project has no boundary');
assert.equal(projectCoverage([edited[0],edited[0]],RADIO_DEFAULTS),null,'duplicate sites are rejected');
assert.equal(selectProjectSites([],[-79.39,43.7]).length,0);
console.log('Seven-site clustering and full coverage project boundary tests passed.');
