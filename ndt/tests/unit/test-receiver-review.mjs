import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareReview,reviewTrace,reviewSample} from '../../dist/drive-test/rf-review-model.mjs';
const r=spawnSync(process.env.PYTHON||'python',['-X','utf8','-B',fileURLToPath(new URL('../fixtures/receiver-review-vectors.py',import.meta.url))],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);const runs=JSON.parse(r.stdout);assert.equal(runs.length,6);
for(const run of runs){const prepared=await prepareReview(run),trace=await reviewTrace({current:prepared});assert.ok(trace.verification.maxAbsDb<1e-7);assert.equal(trace.rows.length,run.rows.length);
 if(run.id.endsWith('-B')){
  const reference=await prepareReview(runs.find(t=>t.id===run.id.replace(/B$/,'A'))),paired=await reviewTrace({current:prepared,reference});
  if(run.id.includes('dual'))for(const row of paired.rows.filter(r=>r.deltaDb!==null))assert.ok(Math.abs(row.deltaDb)<1e-7);
  const target={cellId:'CELL:cell-1',linkId:'link-1'},path=await reviewTrace({current:prepared,reference,target}),zero=path.rows.find(row=>row.current.status==='polarization-null');
  if(!run.id.includes('dual')){
   assert.ok(zero);assert.equal(zero.current.rxDbm,null);assert.equal(zero.current.receiverPowerFraction,0);assert.ok(Number.isFinite(zero.current.scalarRxDbm));
   const sample=reviewSample(prepared,reference,zero.index,target);assert.equal(sample.current.paths[0].receiver.powerFraction,0);
   if(run.id.includes('single'))assert.ok(paired.rows.some(row=>Number.isFinite(row.current.rxDbm)),'a zero port cannot block another collected port');
   else assert.ok(paired.rows.every(row=>row.current.rxDbm===null));
   const blocked=path.rows.find(row=>row.current.blockedPathId==='link-2'&&row.current.receiverPowerFraction===0);
   assert.ok(blocked,'a known zero component can coexist with a blocked second path');
   assert.equal(blocked.current.status,'cell-incomplete');assert.equal(blocked.current.zeroCollectedPower,false);assert.equal(blocked.current.componentZeroCollectedPower,true);
  }
 }
}
const old=structuredClone(runs[1]);old.context.model=old.context.predictionModel='uma-source-patterns-fixed-heights-v5';await assert.rejects(()=>prepareReview(old),/receiver|polarization|model/i);
console.log('Receiver replay: six Python grid/array member runs, preserved scalar baseline, dual identity, zero ports and complete-cell collection passed.');
