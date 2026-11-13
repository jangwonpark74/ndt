import {createInventoryClusterModel} from './inventory-cluster-model.mjs';
import {createInventoryClusterViewModel,inventoryRows,clusterBounds} from './inventory-cluster-view-model.mjs';
import {siteLabel} from './planning-model.mjs';
import {siteLocations} from './network-model.mjs';
import {hideProjectOverview} from './context-panel.mjs';

export function bindInventoryReview({region,map,projectViewModel,networkViewModel}){
 if(region.network!=='ised')return {groups:()=>[],ready:()=>false};
 const $=id=>document.getElementById(id),vm=createInventoryClusterViewModel(createInventoryClusterModel(region.id));
 const section=document.createElement('section');section.id='inventory-review';section.className='overview-card inventory-review';section.setAttribute('aria-labelledby','inventory-title');
 section.innerHTML=`<div class="overview-card-header"><div><h2 id="inventory-title">Site inventory and clusters</h2><p id="inventory-context" class="network-note"></p></div><button type="button" id="inventory-map">Show selected cluster on map</button></div>
  <div class="inventory-controls"><div class="inventory-field"><label for="inventory-cluster">Inventory cluster</label><select id="inventory-cluster"><option value="">Choose a group</option></select></div></div>
  <details id="inventory-manage"><summary>Manage inventory clusters</summary><p class="network-note">Review groups do not change simulation assignments. Save groups to retain edits.</p>
  <div class="inventory-controls"><label>New inventory cluster name<input id="inventory-new-name" maxlength="80"></label><button type="button" id="inventory-create">Create inventory cluster</button></div>
  <div class="inventory-controls"><label>Selected inventory cluster name<input id="inventory-cluster-name" maxlength="80"></label><button type="button" id="inventory-rename">Rename inventory cluster</button><button type="button" id="inventory-delete">Delete selected cluster</button></div>
  <div class="inventory-controls"><button type="button" id="inventory-reload">Reload saved groups</button><button type="button" id="inventory-use-saved">Use saved groups</button><button type="button" id="inventory-remove-missing" hidden>Remove unavailable assignments</button></div></details>
  <div class="inventory-controls"><button type="button" id="inventory-save">Save inventory groups</button><p id="inventory-group-status" role="status" aria-live="polite"></p></div><p id="inventory-group-error" role="alert" hidden></p>
  <div class="inventory-controls"><label>Search site inventory<input id="inventory-query" type="search" placeholder="Site ID, provider or address"></label><div class="inventory-field"><label for="inventory-rat">Reported technology</label><select id="inventory-rat"><option value="all">All reported RATs</option><option value="LTE">4G LTE</option><option value="NR">5G NR</option></select></div><div class="inventory-field"><label for="inventory-scope">Inventory scope</label><select id="inventory-scope"><option value="all">All regional sites</option><option value="members">Planning project members</option><option value="nonmembers">Outside planning project</option><option value="cluster">Selected cluster members</option></select></div><div class="inventory-field"><label for="inventory-sort">Inventory order</label><select id="inventory-sort"><option value="identity">Site identity</option><option value="provider">Provider</option><option value="records">Reported record count</option></select></div></div>
  <p id="inventory-count" role="status" aria-live="polite"></p><p class="inventory-scroll-note network-note">Scroll the table for planning and cluster actions.</p>
  <div class="inventory-scroll" role="region" aria-label="Site inventory table" tabindex="0"><table class="inventory-table"><caption class="visually-hidden">Licensed inventory; source claims do not establish operating status. Review opens the map inspector.</caption><thead><tr><th scope="col">Site / location</th><th scope="col">Reported inventory</th><th scope="col">Bell planning membership</th><th scope="col">Selected review cluster</th></tr></thead><tbody id="inventory-rows"></tbody></table></div>
  <div class="inventory-controls"><button type="button" id="inventory-prev">Previous inventory page</button><span id="inventory-page"></span><button type="button" id="inventory-next">Next inventory page</button></div>`;
 document.querySelector('.overview-grid').after(section);
 let page=0,projectId=null,selectedCluster='',nameFor='',previousSaved=null,previousFeatures=null,previousProjectData=null,previousSaving=false,selectedSite=null;
 const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 const selected=()=>vm.getState().draft.find(c=>c.id===selectedCluster);
 function focusRow(siteId,group=false){if(document.activeElement!==document.body)return;const row=[...$('inventory-rows').children].find(row=>row.querySelector('[data-review]')?.dataset.review===siteId);(row?.querySelector(group?'[data-cluster-action]':'[data-planning-action]') || $('inventory-rows').querySelector('[data-review]') || $('inventory-query')).focus({preventScroll:true});}
 function error(message){$('inventory-group-error').textContent=message;$('inventory-group-error').hidden=!message;}
 function act(callback){try{callback();}catch(issue){error(issue.message);}}
 function table(){
  const state=vm.getState(),project=projectViewModel.getState(),features=networkViewModel.getState().features || [],members=new Set((project.data?.clusters.get(projectId) || []).map(s=>s.properties.site_id));
  const scope=$('inventory-scope').value,group=selected();
  const rows=scope==='cluster' && !group?[]:inventoryRows(features,{query:$('inventory-query').value,rat:$('inventory-rat').value,membership:scope==='cluster'?'all':scope,members,cluster:scope==='cluster'?group:null,sort:$('inventory-sort').value});
  page=Math.max(0,Math.min(page,Math.ceil(rows.length/25)-1));const start=page*25,shown=rows.slice(start,start+25),body=$('inventory-rows');body.replaceChildren();
  for(const site of shown){
   const p=site.properties,id=p.site_id,row=document.createElement('tr');row.setAttribute('aria-current',String(selectedSite===id));
   const identity=document.createElement('td'),review=node('button',siteLabel(site));review.type='button';review.dataset.review=id;review.onclick=()=>document.dispatchEvent(new CustomEvent('reviewnetworksite',{detail:site}));identity.append(review,node('small',siteLocations(site)[0] || 'Address not reported'));row.append(identity);
   row.append(node('td',`${Object.keys(p.technologies || {}).join(' / ') || 'RAT not reported'} · ${p.record_count} source records`));
   const planning=document.createElement('td');
   if(project.data?.sitesById.has(id)){
    const member=members.has(id),button=node('button',member?'Remove from planning project':'Add to planning project');button.type='button';button.disabled=project.saving || project.data.missing.has(projectId) || (!member && !project.data.eligible.has(id));
    if(button.disabled && !member)button.title='Requires three usable reported bearing groups for the current Bell planning workflow.';
    button.dataset.planningAction='';button.onclick=async()=>{try{await projectViewModel.changeSite(project.selected,site,!member);}catch(issue){if(projectId===project.selected.id)error(issue.message);}finally{if(projectId===project.selected.id)focusRow(id);}};planning.append(button);
   }else planning.textContent='Outside Bell planning scope';row.append(planning);
   const cell=document.createElement('td'),assigned=group?.siteIds.includes(id),button=node('button',assigned?'Remove from selected cluster':'Add to selected cluster');button.type='button';button.dataset.clusterAction='';button.disabled=!group || state.loading || state.saving;button.onclick=()=>{act(()=>vm.toggle(group.id,id));focusRow(id,true);};cell.append(button);row.append(cell);body.append(row);
  }
  $('inventory-count').textContent=networkViewModel.getState().loading?'Loading regional inventory…':`${rows.length.toLocaleString()} matching sites · ${shown.length?start+1:0}–${start+shown.length} shown${selectedSite && !rows.some(s=>s.properties.site_id===selectedSite)?' · Selected map site is outside these filters':''}`;
  $('inventory-page').textContent=`Page ${page+1} of ${Math.max(1,Math.ceil(rows.length/25))}`;$('inventory-prev').disabled=page===0;$('inventory-next').disabled=start+25>=rows.length;
 }
 function render(){
  const state=vm.getState(),canEdit=!!state.saved && !state.loading && !state.saving;
  if(!state.draft.some(c=>c.id===selectedCluster))selectedCluster=state.draft[0]?.id || '';
  const picker=$('inventory-cluster');picker.replaceChildren(new Option('Choose a group',''));for(const c of state.draft)picker.add(new Option(`${c.name} (${c.siteIds.length})`,c.id));picker.value=selectedCluster;
  const group=selected();if(nameFor!==selectedCluster || document.activeElement!==$('inventory-cluster-name')){$('inventory-cluster-name').value=group?.name || '';nameFor=selectedCluster;}
  $('inventory-context').textContent=`${region.name} / ${projectViewModel.getState().selected?.name || 'Select a project'}`;
  for(const id of ['inventory-create','inventory-new-name','inventory-cluster'])$(id).disabled=!canEdit;
  for(const id of ['inventory-rename','inventory-cluster-name','inventory-delete'])$(id).disabled=!canEdit || !group;
  $('inventory-map').disabled=!group?.siteIds.length;$('inventory-save').disabled=!canEdit || !state.dirty;$('inventory-save').hidden=!state.dirty && !state.saving;$('inventory-reload').disabled=!projectId || state.loading || state.saving;$('inventory-use-saved').disabled=!canEdit || !state.dirty;
  const missing=state.saved?.missingSiteIds || [];$('inventory-remove-missing').hidden=!missing.length;$('inventory-remove-missing').disabled=!canEdit;
  $('inventory-group-status').textContent=state.loading?'Loading inventory groups…':state.saving?'Saving inventory groups…':!projectId?'Select a project.':!state.saved?'Groups unavailable. Reload to retry.':`${state.dirty?'Unsaved groups':'Saved revision '+state.saved.revision} · ${state.draft.length} named clusters${missing.length?' · '+missing.length+' unavailable site assignments':''}${state.dirty && state.expectedRevision!==state.saved.revision?' · Draft is based on an older saved revision':''}`;
  error(state.error);if(state.error)$('inventory-manage').open=true;table();
  if(previousSaved!==state.saved){previousSaved=state.saved;document.dispatchEvent(new CustomEvent('inventorygroupschange'));}
 }
 $('inventory-create').onclick=()=>act(()=>{const id=crypto.randomUUID();vm.add(id,$('inventory-new-name').value);selectedCluster=id;$('inventory-new-name').value='';render();});
 $('inventory-rename').onclick=()=>act(()=>vm.rename(selectedCluster,$('inventory-cluster-name').value));
 $('inventory-delete').onclick=()=>act(()=>vm.remove(selectedCluster));
 $('inventory-save').onclick=()=>vm.save().catch(()=>{});$('inventory-reload').onclick=()=>vm.load(projectId).catch(()=>{});$('inventory-use-saved').onclick=()=>vm.useSaved();
 $('inventory-remove-missing').onclick=()=>act(()=>vm.removeMissing(new Set(vm.getState().saved?.missingSiteIds || [])));
 $('inventory-cluster').onchange=()=>{selectedCluster=$('inventory-cluster').value;page=0;render();document.dispatchEvent(new CustomEvent('inventorygroupschange'));};
 for(const id of ['inventory-query','inventory-rat','inventory-scope','inventory-sort'])$(id).addEventListener(id==='inventory-query'?'input':'change',()=>{page=0;table();});
 $('inventory-prev').onclick=()=>{page--;table();};$('inventory-next').onclick=()=>{page++;table();};
 $('inventory-map').onclick=()=>{const ids=new Set(selected()?.siteIds || []),sites=(networkViewModel.getState().features || []).filter(s=>ids.has(s.properties.site_id)),bounds=clusterBounds(sites);if(!bounds)return;hideProjectOverview();map.fitBounds(bounds,{padding:{left:innerWidth<=700?35:230,right:80,top:100,bottom:150},maxZoom:16});};
 vm.subscribe(render);
 projectViewModel.subscribe(state=>{
  const changed=state.selected?.id!==projectId;
  if(changed){projectId=state.selected?.id || null;selectedCluster='';page=0;vm.load(projectId).catch(()=>{});if(projectId)networkViewModel.load().catch(issue=>error(issue.message));}
  if(previousProjectData!==state.data || changed || previousSaving!==state.saving){previousProjectData=state.data;previousSaving=state.saving;table();}
 });
 networkViewModel.subscribe(state=>{if(previousFeatures!==state.features || selectedSite!==state.selected?.properties.site_id){previousFeatures=state.features;selectedSite=state.selected?.properties.site_id;table();}});
 return {ready:()=>!!vm.getState().saved,groups:()=>[...(vm.getState().saved?.clusters || [])].sort((a,b)=>Number(b.id===selectedCluster)-Number(a.id===selectedCluster)).map(c=>({...c,selected:c.id===selectedCluster}))};
}
