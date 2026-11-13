import assert from 'node:assert/strict';
import {applyReceiverStudy,removeReceiverStudy,receiverStudyError,receiverTemplates} from '../../dist/receiver-study.mjs';
import {RECEIVER_MODEL} from '../../dist/polarization-model.mjs';
const t={rat:'NR',frequencyMHz:3600,bandwidthMHz:100,powerDbm:30,gainDbi:8,lossDb:2,azimuthDeg:20,tiltDeg:6,pattern:'element',mode:'NLOS'};
const receiver={model:RECEIVER_MODEL,collection:'single-linear',orientation:{azimuthDeg:0,tiltDeg:0,rollDeg:0,slantDeg:0}},draft={name:'Study',template:t,overrides:{site:{...t,azimuthDeg:200}}};
const changed=applyReceiverStudy(draft,receiver,{slantDeg:45,rollDeg:12});
assert.equal(draft.template.mode,'NLOS');assert.equal(draft.receiver,undefined);assert.deepEqual(changed.receiver,receiver);assert.equal(receiverTemplates(changed).length,2);assert.equal(receiverStudyError(changed),'');
for(const p of receiverTemplates(changed)){assert.equal(p.mode,'LOS');assert.deepEqual(p.polarization,{model:'3gpp-38.901-model2',slantDeg:45,rollDeg:12});}
assert.match(receiverStudyError({...changed,receiver:null}),/receiver/i);
assert.match(receiverStudyError({...changed,template:{...changed.template,mode:'NLOS'}}),/LOS/i);
const cells={name:'Cells',template:t,overrides:{},assignmentMode:'cells',cells:[{cellId:'c',ports:[{...t,pattern:'sampled',sampled:{rollDeg:7},equipmentSource:{cellId:'c',linkId:'p'}}]}],radioBudgets:{r:40}};
const selected=applyReceiverStudy(cells,receiver,{slantDeg:-45,rollDeg:18});assert.equal(selected.cells[0].ports[0].sampled.rollDeg,7);assert.deepEqual(selected.cells[0].ports[0].polarization,{model:'3gpp-38.901-model2',slantDeg:-45});assert.deepEqual(selected.radioBudgets,cells.radioBudgets);
const removed=removeReceiverStudy(selected);assert.equal(removed.receiver,undefined);assert.ok(receiverTemplates(removed).every(p=>!Object.hasOwn(p,'polarization')));assert.equal(removed.cells[0].ports[0].mode,'LOS');assert.equal(removed.cells[0].ports[0].sampled.rollDeg,7);
assert.throws(()=>applyReceiverStudy(draft,receiver,{slantDeg:NaN,rollDeg:0}));
console.log('Receiver study: explicit bulk LOS assumptions, grid roll ownership, source preservation and recovery passed.');
