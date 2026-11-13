const scopeKey=scope=>['region_id','project_id','task_id'].map(k=>scope?.[k]||'').join('/');
export class FieldValidation{
 constructor(api,newRequestId){this.api=api;this.newRequestId=newRequestId;}
 listeners=new Set();tests=[];scope='';captureId='';predictionId='';inputs=null;descriptorRaw='';compatibility=null;
 options={cutoffT:NaN,heldoutSites:[],timeGapMs:60000,direction:'forward',toleranceM:50,gapMs:10000,minimumCompatiblePct:90};
 study=null;history=[];page=null;busy='';pageLoading=false;polling=false;error='';generation=0;pageGeneration=0;draftRevision=0;studyRevision=-1;requestId=null;disposed=false;
 listen(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
 emit(){if(!this.disposed)for(const fn of this.listeners)fn();}
 get captures(){return this.tests.filter(t=>t.kind==='imported');}
 get predictions(){return this.tests.filter(t=>t.kind==='simulated');}
 get running(){return ['queued','running'].includes(this.study?.status);}
 get studyStale(){return Boolean(this.study&&this.studyRevision!==this.draftRevision);}
 get optionError(){
  const o=this.options,c=this.inputs?.capture;
  if(!Number.isSafeInteger(o.cutoffT)||!c||!(c.start<o.cutoffT&&o.cutoffT<c.end))return 'Choose a UTC cutoff inside the actual capture period.';
  if(!o.heldoutSites.length)return 'Choose the physical sites reserved for the later holdout.';
  for(const [k,lo,hi,integer] of [['timeGapMs',0,86400000,true],['toleranceM',1,200,false],['gapMs',1,3600000,true],['minimumCompatiblePct',1,100,false]])if(!Number.isFinite(o[k])||o[k]<lo||o[k]>hi||integer&&!Number.isInteger(o[k]))return 'Check the split, route-matching and quality limits.';
  return '';
 }
 get canRun(){return Boolean(this.inputs&&this.compatibility?.ready&&!this.optionError&&!this.busy&&!this.running);}
 changed(){this.draftRevision++;this.requestId=null;this.error='';}
 setContext(tests,scope){
  const key=scopeKey(scope);this.tests=tests.filter(t=>scopeKey(t.scope)===key);
  if(this.scope!==key){this.scope=key;this.generation++;this.pageGeneration++;this.changed();this.captureId='';this.predictionId='';this.inputs=null;this.descriptorRaw='';this.compatibility=null;this.study=null;this.page=null;this.history=[];this.busy='';this.pageLoading=false;this.polling=false;}
  this.emit();
 }
 async perform(kind,operation,accept){
  const generation=this.generation;this.busy=kind;this.error='';this.emit();
  try{const result=await operation();if(!this.disposed&&generation===this.generation)accept(result);}
  catch(e){if(!this.disposed&&generation===this.generation)this.error=e.message;}
  finally{if(!this.disposed&&generation===this.generation){this.busy='';this.emit();}}
 }
 async selectSources(captureId,predictionId){
  this.generation++;this.pageGeneration++;this.changed();this.captureId=captureId;this.predictionId=predictionId;this.inputs=null;this.descriptorRaw='';this.compatibility=null;this.study=null;this.page=null;this.busy='';this.pageLoading=false;this.polling=false;
  this.options={...this.options,heldoutSites:[],cutoffT:NaN};this.emit();
  if(!this.captures.some(t=>t.id===captureId)||!this.predictions.some(t=>t.id===predictionId))return;
  await this.perform('inputs',()=>this.api.loadFieldInputs(captureId,predictionId),result=>{this.inputs=result;this.options.cutoffT=Math.floor((result.capture.start+result.capture.end)/2);});
 }
 setDescriptor(raw){this.generation++;this.pageGeneration++;this.polling=false;this.pageLoading=false;this.changed();this.descriptorRaw=raw;this.compatibility=null;this.busy='';this.emit();}
 setOptions(values){this.changed();this.options={...this.options,...values};this.emit();}
 async check(){
  if(!this.inputs||!this.descriptorRaw||this.busy)return;
  this.compatibility=null;
  await this.perform('check',()=>this.api.checkFieldInputs(this.captureId,this.predictionId,this.descriptorRaw),result=>{this.compatibility=result;});
 }
 async submit(){
  if(!this.canRun)return;
  this.requestId??=this.newRequestId();const revision=this.draftRevision;
  const spec={capture_id:this.captureId,prediction_id:this.predictionId,descriptor_raw:this.descriptorRaw,options:structuredClone(this.options)};
  await this.perform('submit',()=>this.api.submitFieldStudy(this.requestId,spec),result=>{this.study=result;this.studyRevision=revision;this.page=null;});
 }
 async refreshHistory(){
  const generation=this.generation;
  try{const rows=await this.api.loadFieldStudies();if(!this.disposed&&generation===this.generation){const ids=new Set(this.captures.map(t=>t.id));this.history=rows.filter(s=>ids.has(s.spec.capture_id));this.emit();}}
  catch(e){if(!this.disposed&&generation===this.generation){this.error=e.message;this.emit();}}
 }
 async openStudy(id){
  this.generation++;this.pageGeneration++;this.page=null;this.study=null;this.studyRevision=-1;this.polling=false;this.pageLoading=false;
  await this.perform('open',()=>this.api.loadFieldStudy(id),result=>{this.study=result;});
 }
 async poll(){
  if(!this.running||this.polling||this.disposed)return;
  const generation=this.generation,id=this.study.id;this.polling=true;
  try{const result=await this.api.loadFieldStudy(id);if(!this.disposed&&generation===this.generation&&this.study?.id===id){this.study=result;this.error='';this.emit();}}
  catch(e){if(!this.disposed&&generation===this.generation){this.error=e.message;this.emit();}}
  finally{if(generation===this.generation)this.polling=false;}
 }
 async cancel(){
  if(!this.running||this.busy)return;
  const id=this.study.id;
  await this.perform('cancel',()=>this.api.cancelFieldStudy(id),result=>{if(this.study?.id===id)this.study=result;});
 }
 async loadPage(kind='bins',offset=0){
  if(this.study?.status!=='completed')return;
  const generation=this.generation,version=++this.pageGeneration,id=this.study.id;this.pageLoading=true;this.error='';this.emit();
  try{const page=await this.api.loadFieldRecords(id,kind,offset);if(!this.disposed&&generation===this.generation&&version===this.pageGeneration&&this.study?.id===id)this.page=page;}
  catch(e){if(!this.disposed&&generation===this.generation&&version===this.pageGeneration)this.error=e.message;}
  finally{if(!this.disposed&&generation===this.generation&&version===this.pageGeneration){this.pageLoading=false;this.emit();}}
 }
 dispose(){this.disposed=true;this.generation++;this.pageGeneration++;this.listeners.clear();}
}
