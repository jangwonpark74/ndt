import assert from 'node:assert/strict';
import {scenarioChangeRows} from '../../dist/drive-test/scenario-comparison-model.mjs';
const rows=scenarioChangeRows([{label:'Site A',parameter:'tiltDeg',baseline:0,applied:6,affectsPrediction:true},{label:'Site B',parameter:'assignment',baseline:null,applied:'NR',affectsPrediction:true},{label:'Site C',parameter:'carrier',baseline:{band:'n78',channel:640000,scsKHz:30},applied:{band:'n77',channel:640000,scsKHz:30},affectsPrediction:false}]);
assert.deepEqual(rows[0],['Site A','Downtilt (deg)','0','6']);assert.equal(rows[1][2],'Not assigned');assert.match(rows[2][1],/Recorded only/);assert.match(rows[2][2],/n78.*640000.*30 kHz/);
const source=scenarioChangeRows([{label:'Site D',parameter:'equipmentSource',baseline:null,applied:{revision:1,cellId:'cell-1',linkId:'link-1'},affectsPrediction:false}])[0];assert.match(source[3],/Revision 1.*cell-1.*link-1/);
console.log('Comparison labels preserve zeros, missing assignments and carrier/power meaning.');
