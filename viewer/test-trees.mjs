import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { treeSize, visibleTreeTiles, canopyDetail } from './dist/tree-data.mjs';
assert.deepEqual(treeSize([-79.39,43.64,12,6,1,0]), {height:12,diameter:6,conifer:true});
assert.deepEqual(treeSize([-79.39,43.64,0,0,0,0]), {height:8,diameter:4.4,conifer:false});
assert.equal(treeSize([0,0,500,-3,0,0]).height,8);
const center = {lng:-79.39,lat:43.64};
assert.equal(canopyDetail([-79.39,43.64],center),1, 'nearby trees have full crown detail');
assert.equal(canopyDetail([-79.39,43.66],center),0, 'distant trees omit extra crown detail');
assert.ok(canopyDetail([-79.39,43.649],center) > 0 && canopyDetail([-79.39,43.649],center) < 1, 'crown detail fades with distance');
const bounds = {getWest:()=>-79.400, getEast:()=>-79.384, getSouth:()=>43.634, getNorth:()=>43.645};
const manifest = JSON.parse(await readFile(new URL('./dist/trees/manifest.json', import.meta.url)));
const overview = JSON.parse(await readFile(new URL('./dist/trees/overview.geojson', import.meta.url)));
assert.equal(overview.features.length,manifest.mapped+manifest.row_estimates,'the overview covers all extracted trees');
assert.equal(overview.features.filter(f=>f.properties.estimated === 1).length,manifest.row_estimates,'row estimates remain identifiable');
assert.equal(Object.values(manifest.tiles).reduce((sum,n)=>sum+n,0),overview.features.length,'detail tiles and overview have the same coverage');
const keys = visibleTreeTiles(manifest,bounds);
assert.ok(keys.length > 0, 'the benchmark area has OSM tree tiles');
let mapped = 0;
for (const key of keys) {
  const tile = JSON.parse(await readFile(new URL(`./dist/trees/${key}.json`, import.meta.url)));
  assert.equal(tile.length, manifest.tiles[key]);
  mapped += tile.filter(t => t[5] === 0 && t[0]>=-79.400 && t[0]<=-79.384 && t[1]>=43.634 && t[1]<=43.645).length;
}
assert.equal(mapped,672, 'the benchmark window retains its mapped trees');
console.log('Tree sizing, tile selection, and Toronto data checks passed.');
