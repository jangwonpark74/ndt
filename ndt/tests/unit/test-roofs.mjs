import assert from 'node:assert/strict';
import { roofGeometry } from '../../dist/roof-geometry.mjs';
const rect = [[0,0],[20,0],[20,10],[0,10],[0,0]];
const concave = [[0,0],[20,0],[20,5],[10,5],[10,10],[0,10],[0,0]];
const identity = point => point;
for (const shape of ['skillion','gabled','hipped','pyramidal','dome','onion','cone']) {
  const result = roofGeometry([rect], {roof_shape:shape, roof_height:4}, 0, 20, identity);
  assert.ok(result, `${shape} produces geometry`);
  assert.equal(result.eaves, 16);
  const z = result.roof.getAttribute('position').array.filter((_,i)=>i%3===2);
  assert.ok(Math.max(...z) > Math.min(...z), `${shape} varies in height`);
  assert.ok(Math.max(...z) <= 20.0001 && Math.min(...z) >= 15.9999, `${shape} respects total height`);
  result.roof.dispose(); result.wall.dispose();
}
for (const ring of [concave, [...concave].reverse()]) {
  const roof = roofGeometry([ring], {roof_shape:'skillion',roof_height:3}, 0, 12, identity);
  assert.ok(roof, 'concave skillion works with either winding');
  const positions = roof.roof.getAttribute('position');
  let area = 0;
  for(let i=0;i<positions.count;i+=3) area += Math.abs((positions.getX(i+1)-positions.getX(i))*(positions.getY(i+2)-positions.getY(i))-(positions.getY(i+1)-positions.getY(i))*(positions.getX(i+2)-positions.getX(i)))/2;
  assert.ok(Math.abs(area-150)<0.01, 'triangles cover the concave footprint');
  roof.roof.dispose(); roof.wall.dispose();
  const gabled = roofGeometry([ring], {roof_shape:'gabled',roof_height:3}, 0, 12, identity);
  assert.ok(gabled, 'concave gabled roof works with either winding');
  const p = gabled.roof.getAttribute('position');
  let roofArea = 0;
  for (let i=0;i<p.count;i+=3) roofArea += Math.abs((p.getX(i+1)-p.getX(i))*(p.getY(i+2)-p.getY(i))-(p.getY(i+1)-p.getY(i))*(p.getX(i+2)-p.getX(i)))/2;
  assert.ok(Math.abs(roofArea-150)<0.01, 'gabled triangles cover the concave footprint without adding area');
  gabled.roof.dispose(); gabled.wall.dispose();
}
assert.equal(roofGeometry([rect], {roof_shape:'unsupported'}, 0, 10, identity), null);
const courtyard = [[6,3],[10,3],[10,7],[6,7],[6,3]];
for (const hole of [courtyard, [...courtyard].reverse()]) {
  const skillion = roofGeometry([rect,hole], {roof_shape:'skillion',roof_height:3}, 0, 12, identity);
  assert.ok(skillion, 'skillion roof supports a courtyard');
  const p = skillion.roof.getAttribute('position');
  let area = 0;
  for (let i=0;i<p.count;i+=3) area += Math.abs((p.getX(i+1)-p.getX(i))*(p.getY(i+2)-p.getY(i))-(p.getY(i+1)-p.getY(i))*(p.getX(i+2)-p.getX(i)))/2;
  assert.ok(Math.abs(area-184)<0.01, 'roof triangles leave the courtyard open');
  skillion.roof.dispose(); skillion.wall.dispose();
}
assert.equal(roofGeometry([rect,courtyard], {roof_shape:'gabled',roof_height:3}, 0, 12, identity), null, 'unsupported courtyard roofs keep the native building');
console.log('Roof shape, height, and concave-footprint tests passed.');

const { readFile } = await import('node:fs/promises');
const dataset = JSON.parse(await readFile(new URL('../../dist/toronto-roofs.json', import.meta.url)));
const real = dataset.roofs.find(roof => roof.id === 951725944);
assert.equal(real?.shape, 'skillion', 'Toronto OSM way 951725944 retains its mapped shape');
assert.equal(real.id * 10, 9517259440, 'the sampled OpenFreeMap building ID matches the OSM way');
const local = ([lon,lat]) => [(lon + 79.38) * 80600, (43.65 - lat) * 111320];
const actual = roofGeometry([real.ring], {roof_shape:real.shape, roof_height:Number(real.tags['roof:height']), roof_direction:real.tags['roof:direction']}, 230, 250, local);
assert.ok(actual, 'real Toronto concave skillion generates a roof');
assert.equal(actual.eaves, 230);
actual.roof.dispose(); actual.wall.dispose();
console.log('Toronto OSM roof fixture passed.');

const { buildRoofParts, roofFeatureIds } = await import('../../dist/roof-layer.mjs');
const { Color } = await import('../../dist/vendor/three.module.js');
for (const [source, expected] of [['red','#b09b8b'],['#F00','#b09b8b'],['#FF0000','#b09b8b'],['blue','#0000ff'],['brown','#a52a2a'],['darkred','#8b0000'],['#C4957F','#c4957f']]) {
  const result = buildRoofParts({shape:'gabled',ring:rect,tags:{height:'20','roof:height':'4','roof:colour':source,'building:colour':source}}, {render_height:20}, 0, identity);
  const color = new Color(expected);
  for (const part of result.parts) {
    const actual = part.getAttribute('color');
    assert.ok(Math.abs(actual.getX(0)-color.r)<1e-6 && Math.abs(actual.getY(0)-color.g)<1e-6 && Math.abs(actual.getZ(0)-color.b)<1e-6, `${source} keeps its original color except pure red`);
    part.dispose();
  }
}
const brick = buildRoofParts({shape:'flat',ring:rect,tags:{height:'10','roof:material':'brick'}}, {render_height:10}, 0, identity);
const brickColor = new Color('#ad8271'), brickAttribute = brick.parts[0].getAttribute('color');
assert.ok(Math.abs(brickAttribute.getX(0)-brickColor.r)<1e-6 && Math.abs(brickAttribute.getY(0)-brickColor.g)<1e-6 && Math.abs(brickAttribute.getZ(0)-brickColor.b)<1e-6, 'the original brick material palette is preserved');
brick.parts.forEach(part=>part.dispose());
const relation = dataset.roofs.find(roof => roof.type === 'relation' && roof.id === 37964);
assert.ok(relation?.polygons[0].length > 1, 'Osgoode Hall keeps its mapped courtyard');
assert.deepEqual(roofFeatureIds(relation), [379643], 'the sampled relation matches the Toronto tile ID');
assert.deepEqual(roofFeatureIds(dataset.roofs.find(roof => roof.id === 110166031 && !roof.type)), [1101660310,1101660312], 'the sampled way supports both observed tile suffixes');
const fakeFlat = {shape:'flat',ring:rect,tags:{height:'10','roof:colour':'red'}};
const flat = buildRoofParts(fakeFlat, {render_height:10}, 80, identity);
assert.equal(flat.replaceNative, false, 'a flat roof color does not hide the native building');
const flatPosition = flat.parts[0].getAttribute('position');
for (let i=0;i<flatPosition.count;i++) assert.ok(Math.abs(flatPosition.getZ(i)-90.15)<0.001, 'flat roof is at terrain plus building height');
flat.parts.forEach(part=>part.dispose());
const flatCourtyard = buildRoofParts({shape:'flat',polygons:[[rect,courtyard]],tags:{height:'10','roof:colour':'red'}}, {render_height:10}, 80, identity);
assert.ok(flatCourtyard && !flatCourtyard.replaceNative, 'flat multipolygon overlays preserve the native building');
flatCourtyard.parts.forEach(part=>part.dispose());
const pitched = buildRoofParts({shape:'gabled',ring:rect,tags:{height:'20','roof:height':'4'}}, {render_height:20}, 80, identity);
assert.equal(pitched.replaceNative, true, 'a shaped roof replaces the native extrusion');
pitched.parts.forEach(part=>part.dispose());
const elevated = buildRoofParts({shape:'gabled',ring:rect,tags:{height:'20','building:min_level':'2','roof:height':'4'}}, {}, 80, identity);
assert.ok(elevated, 'a mapped building part can use its minimum level');
assert.ok(Math.min(...elevated.parts[0].getAttribute('position').array.filter((_,i)=>i%3===2)) >= 86, 'minimum level is reflected in its base');
elevated.parts.forEach(part=>part.dispose());
assert.equal(buildRoofParts({shape:'unsupported',ring:rect,tags:{height:'20'}}, {render_height:20}, 80, identity), null, 'unsupported shapes keep the native building');
console.log('Roof replacement and terrain alignment tests passed.');
