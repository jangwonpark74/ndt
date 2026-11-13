import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareReview,reviewTrace,reviewSample,reviewTargets,summarizeReview} from '../../dist/drive-test/rf-review-model.mjs';
const path=fileURLToPath(new URL('../fixtures/rf-review-vectors.py',import.meta.url)),r=spawnSync(process.env.PYTHON||'python',['-X','utf8','-B',path],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);const runs=JSON.parse(r.stdout);
for(const current of runs){
 const p=await prepareReview(current),result=await reviewTrace({current:p});assert.equal(result.rows.length,current.rows.length);assert.ok(result.verification.maxAbsDb<1e-7);assert.equal(result.schema,'ndt.rf-review.v1');
 for(let i=0;i<current.rows.length;i++){const expected=current.rows[i].predicted_rx_dbm,actual=result.rows[i].current.rxDbm;if(expected===undefined)assert.equal(actual,null);else assert.ok(Math.abs(actual-expected)<1e-7);}
 assert.ok(result.rows.some(row=>row.current.status==='model-domain'));
 const a=runs.find(t=>t.context.experiment_id===current.context.experiment_id&&t.context.variant!==current.context.variant),reference=await prepareReview(a),delta=await reviewTrace({current:p,reference});
 for(const row of delta.rows.filter(row=>row.deltaDb!==null)){const expected=current.rows[row.index].predicted_rx_dbm-a.rows[row.index].predicted_rx_dbm;assert.ok(Math.abs(row.deltaDb-expected)<1e-7);if(!current.id.startsWith('membership'))assert.ok(Math.abs(row.deltaDb-(current.context.variant==='B'?2:-2))<1e-7);}
 const targets=reviewTargets(p,reference);assert.ok(targets.length>=1);
 if(current.id==='membership-B'){
  const choice=targets.find(t=>t.id==='site-0');assert.equal(choice.current,false);assert.equal(choice.reference,true);
  const selected=await reviewTrace({current:p,reference,target:{cellId:'site-0',linkId:null}});assert.ok(selected.rows.every(row=>row.current.status==='not-assigned'));assert.ok(selected.rows.some(row=>row.reference.rxDbm!==null));assert.ok(selected.rows.every(row=>row.deltaDb===null));
  const stats=summarizeReview(selected,-100);assert.equal(stats.reasons['not-assigned'],selected.rows.length);assert.ok(stats.referenceReasons['model-domain']>0);assert.ok(stats.referenceOnly>0);
 }

 if(current.id.includes('low-null')){const below=await reviewTrace({current:p,target:{cellId:'CELL:cell-1',linkId:'link-1'}});assert.ok(below.rows.some(row=>row.current.status==='below-output'&&Number.isFinite(row.current.componentRxDbm)));}
 if(current.context.transmitters[0].ports?.length===2){
  const target={cellId:'CELL:cell-1',linkId:'link-1'},ports=await reviewTrace({current:p,target});assert.ok(ports.rows.some(row=>row.current.status==='cell-incomplete'&&Number.isFinite(row.current.componentRxDbm)));
  const index=ports.rows.findIndex(row=>row.current.status==='cell-incomplete'),sample=reviewSample(p,null,index,target);assert.equal(sample.current.paths.length,2);assert.equal(sample.current.status,'cell-incomplete');assert.equal(sample.current.rxDbm,null);assert.ok(Number.isFinite(sample.current.componentRxDbm));assert.ok(sample.current.paths.some(path=>path.status==='near-field'));
 }
}
const one=await prepareReview(runs[0]),bad=structuredClone(runs[0]);bad.context.predictionModel='future-model';await assert.rejects(()=>prepareReview(bad),/model/i);
const wrong=structuredClone(runs[0]);wrong.rows.find(row=>Number.isFinite(row.predicted_rx_dbm)).predicted_rx_dbm+=1;
await assert.rejects(async()=>reviewTrace({current:await prepareReview(wrong)}),/recorded|replay|match/i);
const other=structuredClone(runs[1]);other.context.experiment_id='another-experiment';await assert.rejects(async()=>reviewTrace({current:one,reference:await prepareReview(other)}),/paired|experiment/i);
const grid=structuredClone(runs.find(t=>t.context.patternModels));grid.context.inventorySnapshot.operatorEquipment.raw+=' ';await assert.rejects(()=>prepareReview(grid),/hash/i);
const summary=summarizeReview({rows:[{current:{rxDbm:-90,status:'supported'},deltaDb:2},{current:{rxDbm:-110,status:'supported'},deltaDb:-2},{current:{rxDbm:null,status:'near-field'},deltaDb:null}]},-100,5);
assert.equal(summary.supported,2);assert.equal(summary.unavailable,1);assert.equal(summary.sensitivity.calibrated,false);assert.equal(summary.sensitivity.deltaHalfWidthDb,10);assert.equal(summary.aboveRange,1);assert.equal(summary.belowRange,1);
assert.equal(summarizeReview({rows:[]},-100,null).sensitivity,null);assert.throws(()=>summarizeReview({rows:[]},-100,-1),/sensitivity/i);
console.log('Frozen RF review: five Python model oracles, cell/path gating, paired deltas, source hashes, replay refusal and bounded sensitivity passed.');
