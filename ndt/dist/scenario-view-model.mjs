export function createScenarioViewModel(model) {
  const initial={projectId:null,items:[],selected:null,draft:null,dirty:false,loading:false,saving:false,error:''};
  let state={...initial},generation=0;
  const listeners=new Set(),drafts=new Map();
  function update(changes){state={...state,...changes};for(const listener of listeners)listener(state);}
  function selectedDraft(selected){const version=selected?.versions.at(-1);return version ? {name:selected.name,template:structuredClone(version.template),overrides:structuredClone(version.overrides),...Object.fromEntries(['assignmentMode','cells','radioBudgets'].filter(key=>Object.hasOwn(version,key)).map(key=>[key,structuredClone(version[key])]))} : null;}
  async function load(projectId) {
    if(state.projectId)drafts.set(state.projectId,state);
    const token=++generation;
    update({...initial,...drafts.get(projectId),projectId,loading:!!projectId,saving:false,error:''});
    if(!projectId)return;
    try {
      const items=await model.load(projectId);if(token!==generation)return;
      const selected=state.dirty ? state.selected : items.find(s=>s.id===state.selected?.id) || items[0] || null;
      update({items,selected,draft:state.dirty ? state.draft : selectedDraft(selected),loading:false});
    } catch(error){if(token===generation)update({loading:false,error:error.message});throw error;}
  }
  async function save(draft,action='save') {
    if(state.saving || state.loading || !state.projectId)throw Error('Select a project and wait for scenarios to load.');
    const projectId=state.projectId,token=generation,selected=state.selected,submittedDraft=state.draft;
    const body={...draft,action,id:selected?.id || draft.id,expectedRevision:selected?.revision || 0};
    update({saving:true,error:''});
    try {
      const accepted=await model.save(projectId,body);
      const previous=projectId===state.projectId ? state : drafts.get(projectId);
      const stillSelected=previous.selected?.id===selected?.id,changed=previous.draft!==submittedDraft;
      const next={...previous,items:[...previous.items.filter(s=>s.id!==accepted.id),accepted],selected:stillSelected ? accepted : previous.selected,draft:stillSelected && !changed ? selectedDraft(accepted) : previous.draft,dirty:changed || !stillSelected ? previous.dirty : false,saving:false,error:''};
      drafts.set(projectId,next);
      if(token===generation)update(next);
      return accepted;
    } catch(error){if(token===generation)update({saving:false,error:error.message});throw error;}
  }
  return {
    getState:()=>state,subscribe(listener){listeners.add(listener);listener(state);return()=>listeners.delete(listener);},load,save,
    select(id){const selected=state.items.find(s=>s.id===id) || null;update({selected,draft:selectedDraft(selected),dirty:false,error:''});},
    newDraft(draft){update({selected:null,draft,dirty:true,error:''});},
    edit(draft=state.draft){update({dirty:true,draft,error:''});},
  };
}
