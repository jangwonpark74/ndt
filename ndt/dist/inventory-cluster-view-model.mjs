export function clusterBounds(sites){
 if(!sites.length)return null;
 const coordinates=sites.map(s=>s.geometry.coordinates);
 return [[Math.min(...coordinates.map(c=>c[0])),Math.min(...coordinates.map(c=>c[1]))],[Math.max(...coordinates.map(c=>c[0])),Math.max(...coordinates.map(c=>c[1]))]];
}

export function inventoryRows(sites,{query='',rat='all',members=new Set(),membership='all',cluster=null,sort='identity'}={}){
 const text=query.trim().toLocaleLowerCase(),selected=cluster?new Set(cluster.siteIds):null;
 return sites.filter(site=>{
  const p=site.properties,technologies=Object.keys(p.technologies || {}),id=p.site_id;
  return (!text || [id,p.provider,...(p.ised_site_ids || []),...(p.locations || []),...(p.licensees || []),...technologies,...(p.records || []).map(r=>r.location)].join(' ').toLocaleLowerCase().includes(text)) &&
   (rat==='all' || technologies.some(t=>rat==='NR'?/5G|NR/i.test(t):/LTE/i.test(t))) &&
   (membership==='all' || members.has(id)===(membership==='members')) && (!selected || selected.has(id));
 }).sort((a,b)=>{
  const value=site=>sort==='provider'?site.properties.provider || 'TELUS':sort==='records'?site.properties.record_count || 0:site.properties.ised_site_ids?.[0] || site.properties.site_id;
  return sort==='records'?value(b)-value(a) || a.properties.site_id.localeCompare(b.properties.site_id):String(value(a)).localeCompare(String(value(b)),undefined,{numeric:true}) || a.properties.site_id.localeCompare(b.properties.site_id);
 });
}

export function createInventoryClusterViewModel(model){
 let state={projectId:null,saved:null,draft:[],expectedRevision:0,dirty:false,loading:false,saving:false,error:''},generation=0;
 const listeners=new Set(),drafts=new Map();
 const update=changes=>{state={...state,...changes};for(const listener of listeners)listener(state);};
 function edit(draft){if(state.loading || state.saving || !state.saved)throw Error('Load the project groups before editing.');update({draft,dirty:true,error:''});}
 function validName(id,name){if(typeof name!=='string' || !name.trim() || name.length>80 || /[\u0000-\u001f]/.test(name) || state.draft.some(c=>c.id!==id && c.name.toLocaleLowerCase()===name.trim().toLocaleLowerCase()))throw Error('Choose a unique cluster name, up to 80 plain-text characters.');return name.trim();}
 async function load(projectId){
  if(state.projectId && state.dirty)drafts.set(state.projectId,{draft:state.draft,expectedRevision:state.expectedRevision});
  const token=++generation,cached=drafts.get(projectId);
  update({projectId,saved:null,draft:cached?.draft || [],expectedRevision:cached?.expectedRevision || 0,dirty:!!cached,loading:!!projectId,saving:false,error:''});
  if(!projectId)return;
  try{const saved=await model.load(projectId);if(token===generation)update({saved,draft:cached?.draft || saved.clusters,expectedRevision:cached?.expectedRevision ?? saved.revision,loading:false});}
  catch(error){if(token===generation)update({loading:false,error:error.message});throw error;}
 }
 return {getState:()=>state,subscribe(listener){listeners.add(listener);listener(state);return()=>listeners.delete(listener);},load,
  add(id,name){if(state.draft.length>=50 || state.draft.some(c=>c.id===id))throw Error('Choose a unique ID; at most 50 groups per project.');edit([...state.draft,{id,name:validName(id,name),siteIds:[]}]);},
  rename(id,name){const accepted=validName(id,name);edit(state.draft.map(c=>c.id===id?{...c,name:accepted}:c));},
  remove(id){edit(state.draft.filter(c=>c.id!==id));},
  toggle(id,siteId){edit(state.draft.map(c=>c.id===id?{...c,siteIds:c.siteIds.includes(siteId)?c.siteIds.filter(s=>s!==siteId):[...c.siteIds,siteId]}:c));},
  removeMissing(missing){edit(state.draft.map(c=>({...c,siteIds:c.siteIds.filter(id=>!missing.has(id))})));},
  useSaved(){if(!state.saved || state.saving || state.loading)return;drafts.delete(state.projectId);update({draft:state.saved.clusters,expectedRevision:state.saved.revision,dirty:false,error:''});},
  async save(){
   if(!state.saved || !state.dirty || state.saving || state.loading)return;
   const project=state.projectId,token=++generation,body={expectedRevision:state.expectedRevision,sourceFingerprint:state.saved.currentSourceFingerprint,clusters:state.draft};update({saving:true,error:''});
   try{const saved=await model.save(project,body);if(drafts.get(project)?.draft===body.clusters)drafts.delete(project);if(token===generation)update({saved,draft:saved.clusters,expectedRevision:saved.revision,dirty:false,saving:false});}
   catch(error){if(token===generation)update({saving:false,error:error.message});throw error;}
  },
 };
}
