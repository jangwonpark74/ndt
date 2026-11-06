import assert from 'node:assert/strict';
import { meters, buildingHeight, displayBuildings, project, CENTER } from '../dist/osm.mjs';
assert.equal(meters('100 ft'),30.48);
assert.equal(meters('unknown'),null);
assert.equal(buildingHeight({height:'25', 'building:levels':'3'},1).value,25);
assert.deepEqual(buildingHeight({'building:levels':'4'},1),{value:12,source:'Estimated from OSM levels'});
assert.deepEqual(project(CENTER),[0,0]);
const ring=[{lat:0,lon:0},{lat:0,lon:2},{lat:2,lon:2},{lat:2,lon:0},{lat:0,lon:0}];
const part=[{lat:.5,lon:.5},{lat:.5,lon:1},{lat:1,lon:1},{lat:.5,lon:.5}];
assert.deepEqual(displayBuildings([{type:'way',id:1,tags:{building:'yes'},geometry:ring},{type:'way',id:2,tags:{'building:part':'yes'},geometry:part}]).map(x=>x.id),[2]);
console.log('OSM parsing and building tests passed.');

const { layerGroups, featureDetails } = await import('../dist/map-data.mjs');
assert.deepEqual(layerGroups([{id:'roads', 'source-layer':'transportation'}, {id:'road-labels','source-layer':'transportation_name'}, {id:'3d','source-layer':'building'}, {id:'parks','source-layer':'park'}]), {streets:['roads','road-labels'],buildings:['3d']});
assert.deepEqual(featureDetails({sourceLayer:'building',properties:{name:'Example',render_height:42,osm_id:'way/123'}}), {name:'Example',attributes:[['render_height',42],['osm_id','way/123']],osmLink:'https://www.openstreetmap.org/way/123',height:42});
assert.equal(featureDetails({sourceLayer:'transportation',properties:{render_height:9,osm_id:'bad'}}).height,0);
assert.equal(featureDetails({properties:{osm_id:'way/123/extra'}}).osmLink,null);
console.log('Map layer and feature tests passed.');
