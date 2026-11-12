import assert from 'node:assert/strict';
import {Workspace} from '../../dist/drive-test/test-view-model.mjs';
import {DEFAULT_PROFILE} from '../../dist/drive-test/test-model.mjs';
import {ExperimentWorkspace} from '../../dist/drive-test/experiment-view-model.mjs';

const scope={region_id:'toronto',project_id:'p',task_id:'t'};
const capture={id:'one',kind:'imported',scope,profile:structuredClone(DEFAULT_PROFILE),revision:0,start:0,end:1000,
  rows:[{t:0,rat:'NR',rsrp_dbm:-90},{t:1000,rat:'NR',rsrp_dbm:-95}],issues:[],audit:[]};
let resolveOld;
const api={loadTests:async()=>[capture,{...capture,id:'other',scope:{...scope,project_id:'other'}}],
  loadCatalog:async()=>({regions:[],tasks:[]}),loadTest:async id=>id==='old'?new Promise(r=>{resolveOld=r;}):{...capture,id}};
const vm=new Workspace(api,{cancel(){},request(){},now:()=>0},scope);
await vm.start();
assert.deepEqual(vm.tests.map(t=>t.id),['one'],'a Task workspace excludes captures from another project');
const old=vm.open('old');await vm.open('new');resolveOld({...capture,id:'old'});await old;
assert.equal(vm.test.id,'new','late responses cannot replace the current capture');
const generated={...capture,id:'virtual',kind:'simulated',rows:[{t:0,rat:'NR',predicted_rx_dbm:-80},{t:1000,rat:'NR',predicted_rx_dbm:-83}]};
api.loadTest=async()=>generated;
await vm.open('virtual');
assert.equal(vm.metric,'predicted_rx_dbm','planning power never masquerades as measured RSRP');
assert.equal(vm.rat,'NR');
console.log('DM ViewModel injection, context isolation, stale response and simulation metric checks passed.');

const planning={...scope,task:'Task',routes:[{id:'first'},{id:'second'}],speedCases:[{id:'c20',speedKmh:20},{id:'c40',speedKmh:40}],
  routeMetrics:[{id:'first',distanceKm:.1},{id:'second',distanceKm:.2}],transmitters:[{id:'tx'}]};
const experiments=new ExperimentWorkspace({loadExperiments:async()=>[]},{clear(){},set(){}},{...scope,route_id:'second'});
await experiments.load({tasks:[planning],regions:[]});
assert.equal(experiments.state.routeId,'second','a saved-route deep link selects that exact route');
experiments.selectCases(['c40']);assert.deepEqual(experiments.state.caseIds,['c40']);
experiments.selectRoute('first');await experiments.load({tasks:[planning],regions:[]});
assert.equal(experiments.state.routeId,'first','refresh preserves the selected route');
console.log('Experiment route deep links, speed selection and refresh state passed.');
