import assert from 'node:assert/strict';
import {FieldValidation} from '../../dist/drive-test/field-view-model.mjs';
const scope={region_id:'r',project_id:'p',task_id:'t'},tests=[{id:'c',kind:'imported',scope},{id:'v',kind:'simulated',scope},{id:'s',kind:'synthetic',scope},{id:'other',kind:'imported',scope:{...scope,task_id:'other'}}];
const inputs={capture:{id:'c',start:0,end:400000},prediction:{id:'v'},sites:[{id:'A',label:'Site A'},{id:'B',label:'Site B'}],descriptorTemplate:{schema:'draft'}};
const job={id:'FIELD-1',status:'queued',progress:0,spec:{capture_id:'c',prediction_id:'v'},result:null};
const page={studyId:'FIELD-1',kind:'bins',offset:0,limit:50,total:100,rows:[{index:0}]};
const calls=[],api={loadFieldInputs:async()=>structuredClone(inputs),checkFieldInputs:async()=>({ready:true,issues:[],mappings:[{siteId:'A'},{siteId:'B'}]}),loadFieldStudies:async()=>[],submitFieldStudy:async(id,spec)=>{calls.push([id,spec]);return structuredClone(job);},loadFieldStudy:async()=>({...job,status:'completed',result:{status:'diagnostic-complete'}}),loadFieldRecords:async()=>structuredClone(page),cancelFieldStudy:async()=>({...job,status:'cancelled'})};
const vm=new FieldValidation(api,()=>`request-${calls.length}`);vm.setContext(tests,scope);
assert.deepEqual(vm.captures.map(t=>t.id),['c']);assert.deepEqual(vm.predictions.map(t=>t.id),['v']);
await vm.selectSources('c','v');assert.equal(vm.options.cutoffT,200000);assert.equal(vm.descriptorRaw,'');assert.deepEqual(vm.options.heldoutSites,[]);
assert.equal(vm.canRun,false);vm.setDescriptor('{"declared":"test"}');await vm.check();assert.equal(vm.compatibility.ready,true);
vm.setOptions({heldoutSites:['B'],timeGapMs:0});assert.equal(vm.canRun,true);await vm.submit();assert.equal(vm.study.id,'FIELD-1');assert.equal(calls.length,1);assert.equal(vm.studyStale,false);
vm.setOptions({timeGapMs:1000});assert.equal(vm.studyStale,true,'a saved result cannot follow edited split options');await vm.poll();assert.equal(vm.study.status,'completed');assert.equal(vm.studyStale,true);
await vm.loadPage('bins',0);assert.equal(vm.page.total,100);
vm.setDescriptor('changed');assert.equal(vm.compatibility,null);assert.equal(vm.canRun,false);

// Replies for an older scope, source, descriptor, study or page cannot win.
let resolveInputs;api.loadFieldInputs=()=>new Promise(resolve=>resolveInputs=resolve);
const lateInputs=vm.selectSources('c','v');vm.setContext(tests,{...scope,task_id:'other'});resolveInputs(inputs);await lateInputs;assert.equal(vm.inputs,null);assert.equal(vm.busy,'');
vm.setContext(tests,scope);api.loadFieldInputs=async()=>structuredClone(inputs);await vm.selectSources('c','v');
let resolveCheck;api.checkFieldInputs=()=>new Promise(resolve=>resolveCheck=resolve);vm.setDescriptor('old');const lateCheck=vm.check();vm.setDescriptor('new');resolveCheck({ready:true});await lateCheck;assert.equal(vm.compatibility,null);
api.checkFieldInputs=async()=>({ready:true,issues:[]});await vm.check();vm.setOptions({heldoutSites:['B'],timeGapMs:0});
let resolveSubmit;api.submitFieldStudy=()=>new Promise(resolve=>resolveSubmit=resolve);const lateSubmit=vm.submit();await vm.selectSources('c','v');resolveSubmit(job);await lateSubmit;assert.equal(vm.study,null,'the saved late job remains available in history without replacing the active inputs');
await vm.openStudy('FIELD-1');let resolvePage;api.loadFieldRecords=()=>new Promise(resolve=>resolvePage=resolve);
const latePage=vm.loadPage('bins',0);await vm.selectSources('c','v');resolvePage(page);await latePage;assert.equal(vm.page,null);
api.loadFieldStudy=async()=>structuredClone(job);await vm.openStudy('FIELD-1');await vm.cancel();assert.equal(vm.study.status,'cancelled');
vm.dispose();assert.equal(vm.disposed,true);
console.log('Field workflow scope, compatibility, stale replies/results, pagination and cancellation passed.');
