import assert from 'node:assert/strict';
import {RFReview} from '../../dist/drive-test/rf-review-view-model.mjs';
const workers=[],run=id=>({id,sha256:'a'.repeat(64),kind:'simulated',rows:[{t:1,latitude:0,longitude:0},{t:2,latitude:.001,longitude:0}],context:{model:'uma-mean-power-fixed-heights-v1',rat:'NR',transmitters:[{id:'s',label:'Frozen site',coordinates:[0,0],frequency_mhz:3600}]}});
class Worker{messages=[];terminated=false;postMessage(message){this.messages.push(message);}terminate(){this.terminated=true;}}
const vm=new RFReview(()=>{const w=new Worker;workers.push(w);return w;});vm.setContext({current:run('a'),reference:null});assert.equal(vm.available,true);assert.equal(vm.result,null);vm.compute();assert.equal(vm.busy,true);assert.equal(workers[0].messages[0].kind,'review');
const deliver=(worker,kind,fields={})=>worker.onmessage({data:{kind,currentId:'a',referenceId:null,...fields}});
deliver(workers[0],'progress',{done:1,total:2});assert.deepEqual(vm.progress,{done:1,total:2});
const result={schema:'ndt.rf-review.v1',currentId:'a',referenceId:null,target:null,models:['uma-mean-power-fixed-heights-v1'],verification:{maxAbsDb:0},rows:[{index:0,current:{rxDbm:-90,status:'supported'},reference:null,deltaDb:null},{index:1,current:{rxDbm:null,status:'model-domain'},reference:null,deltaDb:null}]};
deliver(workers[0],'complete',{result});assert.equal(vm.busy,false);assert.equal(vm.summary.supported,1);assert.equal(vm.summary.unavailable,1);assert.equal(workers[0].messages.at(-1).kind,'inspect');
vm.inspect(1);deliver(workers[0],'sample',{details:{index:0,current:{label:'wrong old sample'}}});assert.equal(vm.sample,null);deliver(workers[0],'sample',{details:{index:1,current:{label:'selected sample'}}});assert.equal(vm.sample.current.label,'selected sample');
vm.setAnalysis({margin:5});assert.equal(vm.export().analysis.sensitivity.halfWidthDb,5);vm.setAnalysis({threshold:NaN});assert.ok(vm.analysisError);assert.equal(vm.export(),null);vm.setAnalysis({threshold:-100});
const old=workers[0];vm.setTarget({cellId:'s',linkId:null});assert.equal(vm.result,null);assert.equal(old.terminated,true);vm.compute();old.onmessage({data:{kind:'complete',currentId:'a',referenceId:null,result}});assert.equal(vm.result,null);assert.equal(vm.busy,true);
const active=workers[1];vm.cancel();assert.equal(active.terminated,true);active.onerror({message:'late failure'});assert.equal(vm.error,'');assert.equal(vm.phase,'cancelled');
vm.compute();const switched=workers[2];vm.setContext({current:run('b'),reference:null});switched.onerror({message:'old project error'});assert.equal(vm.error,'');assert.equal(switched.terminated,true);assert.equal(vm.current.id,'b');assert.equal(vm.margin,null);
vm.compute();workers[3].onmessage({data:{kind:'complete',currentId:'a',referenceId:null,result}});assert.match(vm.error,/source|identity/i);assert.equal(vm.result,null);assert.equal(vm.busy,false);
vm.setContext({current:run('b'),reference:null,selectionError:'Selected reference did not load.'});assert.equal(vm.available,false);vm.compute();assert.equal(workers.length,4);
vm.setContext({current:{id:'measured',kind:'measured',context:null},reference:null});assert.equal(vm.available,false);vm.compute();assert.equal(workers.length,4);vm.dispose();
console.log('RF review worker cancellation, late messages, source identity, sample selection and explicit sensitivity state passed.');
