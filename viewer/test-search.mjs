import assert from 'node:assert/strict';
import { searchResults } from './dist/search.mjs';

const place = {geometry:{type:'Point',coordinates:[-79.387,43.643]},properties:{name:'CN Tower',city:'Toronto',state:'Ontario',country:'Canada'}};
assert.deepEqual(searchResults({features:[place]}), [{label:'CN Tower, Toronto, Ontario, Canada',coordinates:[-79.387,43.643]}]);
assert.deepEqual(searchResults({features:[{...place,geometry:{type:'Point',coordinates:[181,0]}}, {...place,properties:{}}, null]}), []);
assert.deepEqual(searchResults({features:[{...place,properties:{name:'Toronto',city:'Toronto',country:'Canada'}}]})[0].label, 'Toronto, Canada');
assert.deepEqual(searchResults(null), []);
console.log('Location search result validation passed.');
