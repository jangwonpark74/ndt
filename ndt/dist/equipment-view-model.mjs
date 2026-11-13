export function createEquipmentViewModel(model){
  const initial={projectId:null,inventory:null,preview:null,raw:'',fileName:'',ready:false,busy:false,error:''};
  let state={...initial},generation=0;
  const listeners=new Set(),files=new Map();
  function update(changes){state={...state,...changes};for(const listener of listeners)listener(state);}
  async function load(projectId){
    if(state.projectId)files.set(state.projectId,{raw:state.raw,fileName:state.fileName});
    const token=++generation;update({...initial,...files.get(projectId),projectId,busy:!!projectId});
    if(!projectId)return;
    try{const inventory=await model.load(projectId);if(token===generation)update({inventory,ready:true,busy:false});}
    catch(error){if(token===generation)update({busy:false,error:error.message});throw error;}
  }
  async function preview(raw,fileName){
    if(!state.projectId || !state.ready)throw Error('Select a project and load its saved inventory before previewing.');
    const token=++generation,project=state.projectId;update({raw,fileName,preview:null,busy:true,error:''});
    try{const value=await model.preview(project,raw);if(token===generation)update({preview:value,busy:false});}
    catch(error){if(token===generation)update({busy:false,error:error.message});throw error;}
  }
  async function commit(){
    if(!state.ready || !state.preview || state.busy)throw Error('Preview a valid equipment file before importing.');
    const token=++generation,project=state.projectId;
    const body={raw:state.raw,expectedRevision:state.inventory?.revision || 0,sourceFingerprint:state.preview.sourceFingerprint};
    update({busy:true,error:''});
    try{const inventory=await model.commit(project,body);if(token===generation){files.delete(project);update({inventory,raw:'',fileName:'',preview:null,busy:false});}}
    catch(error){if(token===generation)update({busy:false,error:error.message});throw error;}
  }
  return {getState:()=>state,subscribe(listener){listeners.add(listener);listener(state);return()=>listeners.delete(listener);},load,preview,commit,
    stageFile(fileName){if(!state.projectId || !state.ready)throw Error('Select a project and load its saved inventory before previewing.');generation++;update({raw:'',fileName,preview:null,busy:true,error:''});return state;},
    fail(message){generation++;update({preview:null,busy:false,error:message});}};
}
