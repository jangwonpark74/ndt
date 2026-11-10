import assert from 'node:assert/strict';
import { createProjectViewModel } from '../dist/project-view-model.mjs';
import { createProjectModel } from '../dist/project-model.mjs';

const first = {id:'first'}, second = {id:'second'};
const a = {properties:{site_id:'a'}}, b = {properties:{site_id:'b'}}, c = {properties:{site_id:'c'}};
const data = {clusters:new Map([['first',[a]],['second',[]]]), sitesById:new Map([['a',a],['b',b],['c',c]]), eligible:new Set(['a','b']), missing:new Set()};
let resolveLoad, resolveSave, rejectSave, calls = 0, saves = [];
const model = {
  load() { calls++; return new Promise(resolve => { resolveLoad = resolve; }); },
  save(id, ids) { saves.push([id,ids]); return new Promise((resolve,reject) => { resolveSave = resolve; rejectSave = reject; }); },
};
const vm = createProjectViewModel(model);
let state;
vm.subscribe(value => { state = value; });
const selection1 = vm.select(first), selection2 = vm.select(second);
assert.equal(calls,1);
assert.equal(state.loading,true);
resolveLoad(data);
assert.equal(await selection1,false);
assert.equal(await selection2,true);
assert.equal(state.selected,second);
assert.equal(state.loading,false);
assert.match(vm.coverage({}).status,/No project sites/);
const saving = vm.changeSite(first,b,true);
assert.equal(state.saving,true);
assert.equal(await vm.changeSite(first,b,true),false);
assert.deepEqual(saves,[['first',['a','b']]]);
assert.deepEqual(state.data.clusters.get('first'),[a]);
resolveSave();
assert.equal(await saving,true);
assert.deepEqual(state.data.clusters.get('first'),[a,b]);
assert.equal(state.saving,false);
const failed = vm.changeSite(first,a,false);
rejectSave(new Error('offline'));
await assert.rejects(failed,/offline/);
assert.deepEqual(state.data.clusters.get('first'),[a,b]);
assert.equal(state.saving,false);
await assert.rejects(vm.changeSite(first,c,true),/Invalid project site change/);
state.data.missing.add('first');
await assert.rejects(vm.changeSite(first,a,false),/unavailable/);

let attempts = 0;
const retry = createProjectViewModel({load:async () => { if (++attempts === 1) throw new Error('offline'); return data; }});
await assert.rejects(retry.select(first),/offline/);
assert.equal(await retry.select(first),true);
assert.equal(attempts,2);

const region = {id:'toronto', projects:[{id:'empty',center:[-79,43]},{id:'missing',center:[-79,43]}]};
const site = {type:'Feature',geometry:{type:'Point',coordinates:[-79,43]},properties:{site_id:'a',provider:'Bell',licensees:['Bell Mobility Inc.'],record_count:1,technologies:{LTE:1},records:[{site_type:'O',structure_type:'T',tx_ant_height:'10'}]}};
let saved = {empty:[],missing:['unavailable']}, requests = [];
const repository = createProjectModel(region,'/assets',async (url, options) => {
  requests.push([url,options]);
  return {ok:true,json:async () => url === '/assets/bell-outdoor-sites.geojson' ? {type:'FeatureCollection',features:[site],record_count:1} : saved};
});
const loaded = await repository.load();
assert.deepEqual(loaded.clusters.get('empty'),[]);
assert.equal(loaded.missing.has('missing'),true);
await repository.save('empty',['a']);
assert.equal(requests.at(-1)[0],'/api/regions/toronto/projects/empty/sites');
assert.deepEqual(JSON.parse(requests.at(-1)[1].body),['a']);
saved = {empty:['a','a']};
await assert.rejects(repository.load(),/Invalid saved site list/);
const offline = createProjectModel(region,'/assets',async () => ({ok:false}));
await assert.rejects(offline.load(),/unavailable/);
await assert.rejects(offline.save('empty',[]),/Could not save/);

let categories = {empty:'virtual-drive-test'};
const categoryRepository = createProjectModel(region,'/assets',async (url,options)=>{
  requests.push([url,options]);
  return {ok:true,json:async()=>options ? JSON.parse(options.body) : categories};
});
assert.deepEqual(await categoryRepository.loadUseCases(),categories);
assert.equal(await categoryRepository.saveUseCase('empty','parameter-ab-test'),'parameter-ab-test');
assert.equal(requests.at(-1)[0],'/api/regions/toronto/projects/empty/use-case');
assert.deepEqual(JSON.parse(requests.at(-1)[1].body),{useCase:'parameter-ab-test'});
categories = {empty:'not-a-use-case'};
await assert.rejects(categoryRepository.loadUseCases(),/Invalid/);
await assert.rejects(categoryRepository.saveUseCase('empty','invalid'),/Invalid/);
await assert.rejects(offline.loadUseCases(),/Could not load/);
await assert.rejects(offline.saveUseCase('empty',null),/Could not save/);

let categoryAttempts=0, acceptCategory, failCategory;
const categoryVM=createProjectViewModel({
  loadUseCases:async()=>{if (++categoryAttempts === 1) throw Error('offline'); return {};},
  saveUseCase:()=>new Promise((resolve,reject)=>{acceptCategory=resolve;failCategory=reject;}),
},[first,second]);
await categoryVM.select(first,false);
await assert.rejects(categoryVM.loadUseCases(),/offline/);
assert.match(categoryVM.getState().useCasesError,/Retry/);
await categoryVM.loadUseCases();
assert.equal(categoryVM.getState().useCasesError,'');
const savingCategory=categoryVM.changeUseCase(first,'ai-ran-benchmark');
assert.equal(await categoryVM.changeUseCase(first,null),false);
await categoryVM.select(second,false);
acceptCategory('ai-ran-benchmark'); await savingCategory;
assert.equal(categoryVM.getState().selected,second);
assert.equal(categoryVM.getState().useCases.first,'ai-ran-benchmark');
const failingCategory=categoryVM.changeUseCase(first,null);
failCategory(Error('offline')); await assert.rejects(failingCategory,/offline/);
assert.equal(categoryVM.getState().useCases.first,'ai-ran-benchmark');
assert.equal(categoryVM.getState().pendingUseCase,null);
await assert.rejects(categoryVM.changeUseCase(first,'bad'),/unavailable/);
const clearingCategory=categoryVM.changeUseCase(first,null); acceptCategory(null); await clearingCategory;
assert.equal(categoryVM.getState().useCases.first,null);
console.log('Project view-model selection, persistence and retry passed.');
