import {createEquipmentModel} from './equipment-model.mjs';
import {createCellSourceViewModel} from './cell-source-view-model.mjs';
import {addSourceCell,cellStudyPaths,removeCellPort,setRadioBudget,splitRadioBudget,rebuildCellSources,powerSum,validateCellStudy} from './cell-study.mjs';

export function bindCellStudyView({regionId,getProject,getDraft,getCurrentInventory,isBusy,onEdit,onPort,onSourceChange}){
 const vm=createCellSourceViewModel(createEquipmentModel(regionId));
 const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
 const dialog=el('dialog');dialog.id='cell-study-dialog';dialog.className='cell-study-dialog';dialog.setAttribute('aria-labelledby','cell-study-title');
 dialog.innerHTML='<div class="cell-study-heading"><h2 id="cell-study-title">Source cell assignments</h2><button type="button" id="cell-study-close">Close assignments</button></div><p id="cell-study-source" class="network-note"></p><p id="cell-study-count" role="status"></p><p id="cell-study-issue" role="status"></p><div class="study-actions"><button type="button" id="cell-study-retry" hidden>Retry source loading</button><button type="button" id="cell-study-rebuild" hidden>Rebuild from current source</button></div><p id="cell-study-rebuild-note" class="network-note" hidden>Rebuild copies current reported values and clears carrier checks and array assumptions. Modeled power, loss, environment and budgets for unchanged radios are retained.</p><label for="cell-study-search">Find imported cell or site</label><input type="search" id="cell-study-search" maxlength="100"><label for="cell-study-rat">Imported technology</label><select id="cell-study-rat"><option value="all">All technologies</option><option value="LTE">4G LTE</option><option value="NR">5G NR</option></select><div id="cell-study-rows"></div><div class="study-actions"><button type="button" id="cell-study-prev">Previous cells</button><span id="cell-study-page"></span><button type="button" id="cell-study-next">Next cells</button></div><h3>Shared radio power budgets</h3><p class="network-note">Enter a modeled total conducted-power limit per radio. All assigned LTE and NR ports share it. Reported radio power is evidence, not an allocation. Splitting is an explicit study assumption.</p><div id="cell-budget-rows"></div><details><summary>Execution assumptions</summary><p>Uncorrelated port powers are summed within a cell, with ideal polarization-insensitive power collection. The strongest supported cell of the selected RAT serves each observation. Carrier checks and known radio budgets are required to execute. No coherent inter-port phases, MIMO, reference-signal allocation, interference or verified vendor reconstruction. The template editor probe remains a single-port prediction.</p></details>';
 document.body.append(dialog);
 const $=id=>dialog.querySelector('#'+id);
 let page=0,opener=null,projectId=null,rowsKey='',budgetsKey='',localError='',editing=false;
 const expanded=new Set();
 function paths(){return cellStudyPaths(getDraft(),vm.getState().inventory);}
 function act(action){const active=document.activeElement?.textContent;try{localError='';onEdit(action());}catch(error){localError=error.message;render();}onSourceChange?.();if(dialog.open && document.activeElement===document.body){const next=[...dialog.querySelectorAll('button')].find(b=>b.textContent===active && !b.disabled);(next || $('cell-study-search')).focus();}}
 function button(label,action,disabled=false){const node=el('button',label);node.type='button';node.disabled=disabled;node.onclick=action;return node;}
 function close(){dialog.close();}
 $('cell-study-close').onclick=close;
 dialog.addEventListener('close',()=>{if(!editing && opener?.isConnected)opener.focus();editing=false;});
 $('cell-study-search').oninput=$('cell-study-rat').onchange=()=>{page=0;rowsKey='';render();};
 $('cell-study-prev').onclick=()=>{--page;rowsKey='';render();};
 $('cell-study-next').onclick=()=>{++page;rowsKey='';render();};
 $('cell-study-retry').onclick=()=>vm.retry();
 $('cell-study-rebuild').onclick=()=>act(()=>rebuildCellSources(getDraft(),vm.getState().currentInventory));
 function renderRows(state,draft,resolved){
  const inventory=state.inventory,data=inventory?.data,query=$('cell-study-search').value.trim().toLowerCase(),rat=$('cell-study-rat').value;
  const sectors=new Map((data?.sectors || []).map(s=>[s.id,s])),sites=new Map((data?.sites || []).map(s=>[s.id,s]));
  const filtered=(data?.cells || []).filter(c=>{const site=sites.get(sectors.get(c.sectorId)?.siteId);return (rat==='all'||c.rat===rat) && [c.id,c.cellIdentity,site?.id,site?.inventorySiteId,site?.name].some(v=>String(v || '').toLowerCase().includes(query));});
  const pages=Math.max(1,Math.ceil(filtered.length/25));page=Math.max(0,Math.min(page,pages-1));
  $('cell-study-page').textContent=`Page ${page+1} of ${pages} · ${filtered.length} cells`;
  $('cell-study-prev').disabled=page===0;$('cell-study-next').disabled=page===pages-1;
  const key=JSON.stringify([projectId,inventory?.revision,inventory?.sha256,draft.cells,query,rat,page,state.stale,isBusy()]);if(key===rowsKey)return;rowsKey=key;
  const container=$('cell-study-rows');container.replaceChildren();
  if(!data){container.append(el('p',state.loading?'Loading original source…':'Import reviewed equipment in this project to assign cells.'));return;}
  if(!filtered.length)container.append(el('p','No imported cells match this search.'));
  for(const cell of filtered.slice(page*25,page*25+25)){
   const label=cell.cellIdentity || cell.id,site=sites.get(sectors.get(cell.sectorId)?.siteId),assigned=resolved.find(c=>c.cellId===cell.id),links=data.links.filter(l=>l.cellId===cell.id),assignedLinks=new Set(assigned?.ports.map(p=>p.link.id));
   const card=el('article');card.className='cell-study-card';
   card.append(el('h4',`${label} · ${cell.rat} · ${assigned?.ports.length || 0}/${links.length} paths assigned`),el('p',`${site?.name || 'Site'} · inventory ${site?.inventorySiteId || 'unknown'} · sector ${cell.sectorId} · ${cell.id} · ${cell.frequencyMHz ?? 'Unreported'} MHz / ${cell.bandwidthMHz ?? 'Unreported'} MHz`));
   const add=button(`Assign ${label}`,()=>{expanded.add(cell.id);act(()=>addSourceCell(getDraft(),inventory,cell.id,links.filter(l=>!assignedLinks.has(l.id)).map(l=>l.id)));},isBusy() || state.stale || !links.length || links.every(l=>assignedLinks.has(l.id)));card.append(add);
   const details=el('details');details.open=expanded.has(cell.id);details.ontoggle=()=>{if(details.open)expanded.add(cell.id);else expanded.delete(cell.id);};details.append(el('summary','Assigned port paths'));
   for(const port of assigned?.ports || []){
    const path=`${port.radioPort.name || port.radioPort.id} → ${port.antennaPort.name || port.antennaPort.id}`,actions=el('div');actions.className='study-actions';
    actions.append(button(`Edit ${label} / ${path}`,()=>{editing=true;close();onPort(`${cell.id}/${port.link.id}`);},isBusy()),button(`Remove ${label} / ${path}`,()=>act(()=>removeCellPort(getDraft(),inventory,cell.id,port.link.id)),isBusy()));
    details.append(el('p',`${port.radio.id} / ${path} / ${port.antenna.model || port.antenna.id} · ${Number.isFinite(port.template.powerDbm)?port.template.powerDbm.toFixed(1):'Unknown'} dBm conducted`),actions);
   }
   if(assigned)card.append(details);container.append(card);
  }
 }
 function renderBudgets(state,draft,resolved){
  const radios=new Map();for(const cell of resolved)for(const port of cell.ports)radios.set(port.radio.id,port.radio);
  const key=JSON.stringify([projectId,state.inventory?.revision,state.inventory?.sha256,[...radios.keys()],isBusy()]);
  if(key!==budgetsKey){
   budgetsKey=key;$('cell-budget-rows').replaceChildren();
   for(const [id,radio]of radios){
    const row=el('section');row.className='cell-budget-row';row.dataset.radio=id;const label=el('label',`Modeled budget for ${id} (dBm)`),input=el('input');input.type='number';input.min='-30';input.max='80';input.step='any';input.disabled=isBusy();label.append(input);
    const reported=el('p',`${radio.model || id} · Reported power: ${radio.powerDbm ?? 'not reported'}${radio.powerDbm===null || radio.powerDbm===undefined?'':' dBm'}`),summary=el('p');summary.className='cell-budget-allocation';summary.setAttribute('role','status');
    input.oninput=()=>act(()=>setRadioBudget(getDraft(),id,input.value.trim()===''?null:Number(input.value)));
    row.append(label,reported,summary,button(`Split ${id} budget evenly`,()=>act(()=>splitRadioBudget(getDraft(),state.inventory,id)),isBusy()));$('cell-budget-rows').append(row);
   }
  }
  for(const row of $('cell-budget-rows').children){
   const id=row.dataset.radio,input=row.querySelector('input'),budget=draft.radioBudgets[id],ports=resolved.flatMap(c=>c.ports).filter(p=>p.radio.id===id),allocated=powerSum(ports.map(p=>p.template.powerDbm));
   if(document.activeElement!==input)input.value=budget ?? '';
   row.querySelector('.cell-budget-allocation').textContent=`${Number.isFinite(allocated)?allocated.toFixed(1):'Unknown'} dBm allocated across ${ports.length} ports${budget===null?' · budget unknown':` · ${budget.toFixed(1)} dBm budget`}`;
   row.querySelector('button').disabled=isBusy() || !Number.isFinite(budget);
  }
 }
 function render(){
  const draft=getDraft(),state=vm.getState();if(draft?.assignmentMode!=='cells')return;
  let resolved=[],pathError='';try{resolved=paths();}catch(error){pathError=error.message;}
  const count=draft.cells?.length || 0,ports=(draft.cells || []).reduce((n,c)=>n+c.ports.length,0),summary=`${count} ${count===1?'cell':'cells'} · ${ports} ${ports===1?'port':'ports'} · ${Object.keys(draft.radioBudgets || {}).length} ${Object.keys(draft.radioBudgets || {}).length===1?'radio':'radios'}`;
  document.getElementById('cell-study-summary').textContent=summary;$('cell-study-count').textContent=summary;
  $('cell-study-source').textContent=`${getProject()?.name || ''} · ${state.loading?'Loading original source':state.inventory?`Source revision ${state.inventory.revision}${state.stale?' · historical or regional source changed':' · current source'}`:'No equipment source'}${state.currentInventory && state.currentInventory.revision!==state.inventory?.revision?` · latest revision ${state.currentInventory.revision}`:''}`;
  const issue=localError || state.error || pathError || validateCellStudy(draft,state.inventory,{qualified:true,currentInventory:state.currentInventory});$('cell-study-issue').textContent=issue || 'Ready for qualified cell execution. Save, set baseline and apply the reviewed revision.';$('cell-study-issue').dataset.invalid=String(!!issue);
  $('cell-study-retry').hidden=!state.error;
  const current=state.currentInventory;$('cell-study-rebuild').hidden=!state.stale || !current || current.sourceFingerprint!==current.currentSourceFingerprint;$('cell-study-rebuild').disabled=isBusy() || state.loading;$('cell-study-rebuild-note').hidden=$('cell-study-rebuild').hidden;
  if(state.stale && current?.sourceFingerprint!==current?.currentSourceFingerprint)$('cell-study-issue').textContent='Regional inventory changed. Re-import reviewed equipment against the current regional source before rebuilding.';
  renderRows(state,draft,resolved);renderBudgets(state,draft,resolved);
 }
 vm.subscribe(()=>queueMicrotask(()=>{render();onSourceChange?.();}));
 return {
  sync(){const next=getProject()?.id || null;if(next!==projectId){if(dialog.open)close();projectId=next;page=0;rowsKey='';budgetsKey='';localError='';expanded.clear();}vm.setContext(next,getDraft(),getCurrentInventory());render();},
  open(trigger=document.activeElement){opener=trigger;localError='';render();dialog.showModal();$('cell-study-search').focus();},
  getInventory:()=>vm.getState().inventory,
  validationError:()=>dialog.querySelector('input[type=number]:invalid')?'Correct the modeled radio budget before saving.':validateCellStudy(getDraft(),vm.getState().inventory),
 };
}
