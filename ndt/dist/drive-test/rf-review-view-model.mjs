import {RF_MODELS,summarizeReview} from './rf-review-summary.mjs';

const source=test=>test?{id:test.id,sha256:test.sha256,kind:test.kind,scope:test.scope,context:test.context,rows:test.rows}:null;
export class RFReview{
 constructor(createWorker){this.createWorker=createWorker;}
 current=null;reference=null;loading=false;selectionError='';target=null;result=null;sample=null;index=0;targets=[];threshold=-100;margin=null;mode='power';phase='ready';error='';busy=false;progress={done:0,total:0};listeners=new Set();worker=null;generation=0;disposed=false;
 listen(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
 emit(change='full'){for(const fn of this.listeners)fn(change);}
 get modelAvailable(){return this.current?.kind==='simulated'&&RF_MODELS.includes(this.current.context?.predictionModel||this.current.context?.model);}
 get available(){return !this.loading&&!this.selectionError&&this.modelAvailable;}
 get analysisError(){try{summarizeReview({rows:[]},this.threshold,this.margin);return '';}catch(e){return e.message;}}
 get summary(){return this.result&&!this.analysisError?summarizeReview(this.result,this.threshold,this.margin):null;}
 stop(phase){this.generation++;this.worker?.terminate();this.worker=null;this.busy=false;this.phase=phase;this.result=null;this.sample=null;this.progress={done:0,total:0};}
 setContext({current,reference=null,loading=false,selectionError=''}){
  if(this.disposed||current===this.current&&reference===this.reference&&loading===this.loading&&selectionError===this.selectionError)return;
  const changed=current?.id!==this.current?.id;this.stop(loading?'loading':'ready');this.current=current;this.reference=reference;this.loading=loading;this.selectionError=selectionError;this.error='';this.targets=[];this.index=0;
  if(changed){this.target=null;this.margin=null;this.mode='power';const value=current?.context?.evaluation_profile?.thresholds?.predicted_rx_dbm?.[current?.context?.rat];this.threshold=Number.isFinite(value)?value:-100;}
  if(!reference)this.mode='power';this.emit('context');
 }
 setTarget(target){this.stop('ready');this.target=target?.cellId?{cellId:target.cellId,linkId:target.linkId||null}:null;this.index=0;this.error='';this.emit();}
 setAnalysis(values){if(values.mode&&!['power','delta'].includes(values.mode))throw Error('Choose a supported RF map view.');Object.assign(this,values);this.emit('analysis');}
 fail(message){this.stop('failed');this.error=message;this.emit();}
 compute(){
  if(this.disposed||!this.available)return;this.stop('running');this.error='';this.busy=true;const generation=this.generation;
  try{
   const worker=this.worker=this.createWorker();
   worker.onmessage=event=>{
    if(this.disposed||generation!==this.generation)return;const m=event.data;
    if(m.currentId!==this.current.id||(m.referenceId??null)!==(this.reference?.id??null))return this.fail('RF review source identity changed. Compute the current frozen selection again.');
    if(m.kind==='error')return this.fail(m.message||'The frozen RF review failed.');
    if(m.kind==='ready'){this.targets=m.targets;return this.emit('targets');}
    if(m.kind==='progress'){this.progress={done:m.done,total:m.total};return this.emit('progress');}
    if(m.kind==='complete'){
     const r=m.result;if(r.currentId!==this.current.id||(r.referenceId??null)!==(this.reference?.id??null)||JSON.stringify(r.target)!==JSON.stringify(this.target))return this.fail('RF review result identity does not match the selected frozen inputs.');
     this.result=r;this.busy=false;this.phase='complete';this.index=Math.min(this.index,r.rows.length-1);this.emit();this.inspect(this.index);
    }else if(m.kind==='sample'&&this.result&&m.details.index===this.index){this.sample=m.details;this.emit('sample');}
   };
   worker.onerror=event=>{event.preventDefault?.();if(!this.disposed&&generation===this.generation)this.fail(event.message||'RF review worker unavailable. Reload or compute again.');};
   worker.postMessage({kind:'review',current:source(this.current),reference:source(this.reference),target:this.target});this.emit();
  }catch(error){this.fail(error.message);}
 }
 inspect(index){if(!this.result||!Number.isInteger(index)||index<0||index>=this.result.rows.length)return;this.index=index;this.sample=null;this.worker.postMessage({kind:'inspect',index});this.emit('cursor');}
 cancel(){this.stop('cancelled');this.error='';this.emit();}
 export(){if(!this.result||this.analysisError)return null;return {schema:'ndt.rf-review-package.v1',source:{current:source(this.current),reference:source(this.reference)},analysis:{thresholdDbm:this.threshold,mode:this.mode,deltaZeroToleranceDb:1e-7,sensitivity:this.summary.sensitivity,uncertainty:'Field uncertainty is not calibrated; any symmetric range is a user-entered bounded sensitivity assumption, not a confidence interval.'},review:this.result,summary:this.summary,selectedSample:this.sample};}
 dispose(){this.stop('disposed');this.disposed=true;this.listeners.clear();}
}
