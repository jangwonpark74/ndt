import assert from 'node:assert/strict';
import {receiverDescription} from '../../dist/drive-test/scenario-comparison-model.mjs';
const receiver={model:'ndt.receiver.los-model2.v1',collection:'single-linear',orientation:{azimuthDeg:20,tiltDeg:0,rollDeg:3,slantDeg:45}};
assert.match(receiverDescription(receiver),/Model-2.*45.*slant/);
assert.match(receiverDescription({...receiver,collection:'dual-orthogonal'}),/dual.*no extra gain/i);
import {scenarioChangeRows} from '../../dist/drive-test/scenario-comparison-model.mjs';
import {antennaDescription} from '../../dist/drive-test/scenario-comparison-model.mjs';
const arrayText=antennaDescription({pattern:'array',array:{rows:4,columns:8,verticalSpacing:.5,horizontalSpacing:.5,steerAzimuthDeg:20,steerDowntiltDeg:6}});
assert.match(arrayText,/Uniform panel array.*4 × 8/);assert.ok(!arrayText.includes('\uFFFD'));
const rows=scenarioChangeRows([{label:'Site A',parameter:'tiltDeg',baseline:0,applied:6,affectsPrediction:true},{label:'Site B',parameter:'assignment',baseline:null,applied:'NR',affectsPrediction:true},{label:'Site C',parameter:'carrier',baseline:{band:'n78',channel:640000,scsKHz:30},applied:{band:'n77',channel:640000,scsKHz:30},affectsPrediction:false}]);
assert.deepEqual(rows[0],['Site A','Downtilt (deg)','0','6']);assert.equal(rows[1][2],'Not assigned');assert.match(rows[2][1],/Recorded only/);assert.match(rows[2][2],/n78.*640000.*30 kHz/);
const source=scenarioChangeRows([{label:'Site D',parameter:'equipmentSource',baseline:null,applied:{revision:1,cellId:'cell-1',linkId:'link-1'},affectsPrediction:false}])[0];assert.match(source[3],/Revision 1.*cell-1.*link-1/);

const sampled={format:'ndt.scalar-gain-grid.v1',patternId:'vendor-grid',rollDeg:12};
const gridRows=scenarioChangeRows([{label:'Cell / path',parameter:'pattern',baseline:'element',applied:'sampled',affectsPrediction:true},{label:'Cell / path',parameter:'sampled',baseline:null,applied:sampled,affectsPrediction:true}]);
assert.equal(gridRows[0][3],'Imported scalar grid');assert.match(gridRows[1][3],/vendor-grid.*12° mechanical roll/);assert.match(antennaDescription({pattern:'sampled',sampled}),/Imported scalar grid.*vendor-grid.*12° mechanical roll/);

console.log('Comparison labels preserve zeros, missing assignments and carrier/power meaning.');
