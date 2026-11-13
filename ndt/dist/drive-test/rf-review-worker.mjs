import {prepareReview,reviewTrace,reviewSample,reviewTargets} from './rf-review-model.mjs';
let generation=0,state=null;
self.onmessage=async event=>{
 const message=event.data;
 if(message.kind==='review'){
  const token=++generation;state=null;const ids={currentId:message.current.id,referenceId:message.reference?.id??null},send=(kind,fields)=>{if(token===generation)self.postMessage({kind,...ids,...fields});};
  try{
   const current=await prepareReview(message.current),reference=message.reference?await prepareReview(message.reference):null;
   send('ready',{targets:reviewTargets(current,reference)});
   const result=await reviewTrace({current,reference,target:message.target,onProgress:progress=>send('progress',progress)});
   if(token===generation)state={current,reference,target:message.target,ids};send('complete',{result});
  }catch(error){send('error',{message:error.message});}
 }else if(message.kind==='inspect'&&state){
  try{self.postMessage({kind:'sample',...state.ids,details:reviewSample(state.current,state.reference,message.index,state.target)});}catch(error){self.postMessage({kind:'error',...state.ids,message:error.message});}
 }
};
