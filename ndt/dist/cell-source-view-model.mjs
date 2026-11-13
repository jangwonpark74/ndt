export function createCellSourceViewModel(model){
 let state={projectId:null,inventory:null,currentInventory:null,loading:false,stale:false,error:''},signature='',generation=0,lastContext;
 const listeners=new Set();
 const update=value=>{state={...state,...value};for(const listener of listeners)listener(state);};
 const same=(inventory,reference)=>inventory?.revision===reference?.revision && inventory?.sha256===reference?.sha256;
 const stale=(inventory,current)=>!!inventory && (!current || !same(inventory,current) || !current.currentSourceFingerprint || current.sourceFingerprint!==current.currentSourceFingerprint);
 async function setContext(projectId,draft,currentInventory,force=false){
  lastContext=[projectId,draft,currentInventory];
  const reference=draft?.assignmentMode==='cells'?draft.cells?.[0]?.ports?.[0]?.equipmentSource:null;
  const key=JSON.stringify([projectId,reference?.revision,reference?.sha256,currentInventory?.revision,currentInventory?.sha256,currentInventory?.sourceFingerprint,currentInventory?.currentSourceFingerprint]);
  if(key===signature && !force)return;
  signature=key;const token=++generation,previous=state.projectId===projectId?state.inventory:null;
  if(!projectId){update({projectId:null,inventory:null,currentInventory:null,loading:false,stale:false,error:''});return;}
  if(!reference || same(currentInventory,reference)){
   update({projectId,inventory:currentInventory,currentInventory,loading:false,stale:stale(currentInventory,currentInventory),error:''});return;
  }
  if(same(previous,reference) && !force){update({projectId,inventory:previous,currentInventory,loading:false,stale:stale(previous,currentInventory),error:''});return;}
  update({projectId,inventory:null,currentInventory,loading:true,stale:true,error:''});
  try{
   const inventory=await model.load(projectId,reference.revision);
   if(!same(inventory,reference))throw Error('The original equipment revision/hash is unavailable in this project.');
   if(token===generation)update({inventory,loading:false,stale:stale(inventory,currentInventory),error:''});
  }catch(error){if(token===generation)update({inventory:null,loading:false,error:error.message});}
 }
 return {getState:()=>state,setContext,retry:()=>lastContext?setContext(...lastContext,true):Promise.resolve(),subscribe(listener){listeners.add(listener);listener(state);return()=>listeners.delete(listener);}};
}
