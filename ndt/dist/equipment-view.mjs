import {createEquipmentModel} from './equipment-model.mjs';
import {createEquipmentViewModel} from './equipment-view-model.mjs';

export function bindEquipmentView({regionId,getProject}){
  const $=id=>document.getElementById(id),model=createEquipmentModel(regionId),vm=createEquipmentViewModel(model);
  let reservation=null,renderedInventory=null,renderedProject=null;
  const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const value=(v,unit='')=>v===null || v===undefined ? 'Not reported' : `${v}${unit}`;
  function download(raw,name){const link=element('a');link.href=URL.createObjectURL(new Blob([raw],{type:'application/json'}));link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
  function facts(parent,fields){const list=element('dl',undefined,'site-facts');for(const [name,content]of fields)list.append(element('dt',name),element('dd',content));parent.append(list);}
  function cuts(parent,pattern){
    const details=element('details');details.append(element('summary',`Pattern cuts: ${pattern.name || pattern.id}`));
    for(const [cut,extent]of [['horizontal',180],['vertical',90]]){
      const maximum=Math.max(1,...pattern[cut].map(point=>point[1]));
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 280 130');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${cut} relative antenna attenuation, 0 to ${maximum} dB`);
      const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=`${cut}: ${pattern[cut].length} source samples`;svg.append(title);
      const path=document.createElementNS(svg.namespaceURI,'polyline');path.setAttribute('points',pattern[cut].map(([angle,loss])=>`${38+(angle+extent)/(2*extent)*232},${10+loss/maximum*90}`).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke','#195c45');path.setAttribute('stroke-width','2');svg.append(path);
      for(const [x,y,text]of [[10,125,`-${extent} deg`],[215,125,`${extent} deg`],[1,9,'0 dB'],[1,105,`${maximum} dB`]]){const label=document.createElementNS(svg.namespaceURI,'text');label.setAttribute('x',x);label.setAttribute('y',y);label.setAttribute('font-size','10');label.setAttribute('fill','#263e36');label.textContent=text;svg.append(label);}
      details.append(element('p',`${cut} cut`),svg);
    }
    parent.append(details);
  }
  function renderSite(container,feature){
    container.querySelector('#imported-equipment')?.remove();
    const inventory=vm.getState().inventory;if(!inventory)return;
    const data=inventory.data,tables=Object.fromEntries(Object.entries(data).filter(([,rows])=>Array.isArray(rows)).map(([kind,rows])=>[kind,new Map(rows.map(row=>[row.id,row]))]));
    const identity=String(feature.properties.site_id ?? feature.properties.id),sites=data.sites.filter(s=>s.inventorySiteId===identity);
    const group=element('details');group.id='imported-equipment';group.append(element('summary','Imported equipment topology'));
    group.append(element('p',`User-supplied configuration, revision ${inventory.revision}. Physical deployment has not been independently verified.`,'network-note'));
    if(!sites.length){group.append(element('p','No imported equipment for this location in the selected project.','network-note'));container.append(group);return;}
    const filter=element('select');filter.setAttribute('aria-label','Filter imported RAT');for(const [v,label]of [['all','All imported technologies'],['LTE','4G LTE'],['NR','5G NR']])filter.add(new Option(label,v));group.append(filter);
    const body=element('div',undefined,'equipment-cells');group.append(body);
    function render(){
      body.replaceChildren();const siteIds=new Set(sites.map(s=>s.id)),sectors=data.sectors.filter(s=>siteIds.has(s.siteId)),sectorIds=new Set(sectors.map(s=>s.id));
      const cells=data.cells.filter(c=>sectorIds.has(c.sectorId) && (filter.value==='all' || filter.value===c.rat));
      if(!cells.length)body.append(element('p','No imported cells for this selection.','network-note'));
      for(const cell of cells){
        const card=element('details',undefined,'topology-group'),sector=tables.sectors.get(cell.sectorId),site=tables.sites.get(sector.siteId),radio=tables.radios.get(cell.radioId);
        card.append(element('summary',`${cell.rat} · ${cell.cellIdentity || cell.id}`));
        facts(card,[['Cell / sector',`${cell.id} / ${sector.id}`],['Reported azimuth',value(sector.azimuthDeg,' degrees')],['Carrier',value(cell.frequencyMHz,' MHz')],['Bandwidth',value(cell.bandwidthMHz,' MHz')],['Radio',radio ? `${radio.id}: ${radio.model || 'Model not reported'}` : 'Not reported'],['TX power',value(radio?.powerDbm,' dBm')]]);
        const evidence=[site,sector,cell,...(radio ? [radio] : [])],links=data.links.filter(l=>l.cellId===cell.id);
        if(!links.length)card.append(element('p','No port-to-antenna connection is reported.','network-note'));
        for(const link of links){
          const rp=tables.ports.get(link.radioPortId),ap=tables.ports.get(link.antennaPortId),antenna=tables.antennas.get(ap.equipmentId),pattern=tables.patterns.get(antenna.patternId);
          const path=element('ol',undefined,'equipment-path');for(const text of [`Cell ${cell.id}`,`Radio ${radio.id} / TX port ${rp.id}`,`Antenna ${antenna.id} / port ${ap.id}`])path.append(element('li',text));card.append(path);
          facts(card,[['Antenna model',antenna.model || 'Not reported'],['Peak gain',value(antenna.gainDbi,' dBi')],['Downtilt',value(antenna.tiltDeg,' degrees')]]);
          evidence.push(link,rp,ap,antenna);if(pattern){evidence.push(pattern);cuts(card,pattern);}else card.append(element('p','Vendor radiation pattern not reported.','network-note'));
          if(regionId==='toronto'){
            const use=element('button',`Use ${rp.name || rp.id} → ${ap.name || ap.id} in study`);use.type='button';
            use.onclick=()=>{if(vm.getState().inventory!==inventory)return;document.dispatchEvent(new CustomEvent('equipmentstudyrequested',{detail:{projectId:vm.getState().projectId,siteId:identity,reference:{revision:inventory.revision,sha256:inventory.sha256,cellId:cell.id,linkId:link.id}}}));group.open=false;};
            const actions=element('div',undefined,'study-actions');actions.append(use);card.append(actions,element('p','Creates a reference-element site study. Carrier/port power, loss and environment remain editable assumptions.','network-note'));
          }
        }
        const sources=element('details');sources.append(element('summary','Source records'));
        for(const node of new Map(evidence.map(e=>[`${e.sourceId}:${e.id}`,e])).values()){
          const source=tables.sources.get(node.sourceId),p=element('p',`${node.id}: ${node.sourceRecordId} · ${source.kind} · ${source.title} · observed ${source.observedAt}`);
          if(/^https?:/i.test(source.uri)){const link=element('a','Open source');link.href=source.uri;link.target='_blank';link.rel='noopener noreferrer';p.append(' ',link);}else p.append(' ',source.uri);sources.append(p);
        }
        card.append(sources);body.append(card);
      }
    }
    filter.onchange=render;render();container.append(group);
  }
  vm.subscribe(state=>{
    $('equipment-file').disabled=!state.projectId || !state.ready || state.busy;
    $('equipment-reload').disabled=!state.projectId || state.busy;
    $('equipment-repreview').disabled=!state.raw || state.busy || !state.ready;
    $('equipment-import').disabled=!state.preview || state.busy;
    $('equipment-error').textContent=state.error;$('equipment-error').hidden=!state.error;
    const counts=state.inventory?.data;
    $('equipment-status').textContent=state.busy ? 'Loading or validating equipment...' : !state.projectId ? 'Select a project to review its equipment inventory.' : state.inventory ? `Revision ${state.inventory.revision} · ${counts.sites.length} sites · ${counts.cells.length} cells · ${counts.radios.length} radios · ${counts.antennas.length} antennas` : 'No operator equipment has been imported for this project.';
    const preview=$('equipment-preview');preview.replaceChildren();preview.hidden=!state.preview;
    if(state.preview){preview.append(element('strong',state.fileName),element('p',Object.entries(state.preview.counts).map(([key,count])=>`${count} ${key}`).join(' · ')));if(state.preview.unlinkedCells)preview.append(element('p',`${state.preview.unlinkedCells} cells have no mapped antenna connection.`));const hash=element('p',`Source SHA-256: ${state.preview.sha256.slice(0,16)}...`);hash.title=state.preview.sha256;preview.append(hash);}
    $('equipment-history').replaceChildren();for(const version of state.inventory?.history || []){const li=element('li'),button=element('button',`Download revision ${version.revision}`);button.type='button';button.onclick=async()=>{const token=vm.getState();try{const saved=await model.load(state.projectId,version.revision);download(saved.raw,`equipment-revision-${version.revision}.json`);}catch(error){if(vm.getState()===token)vm.fail(error.message);}};li.append(button,element('span',` ${new Date(version.importedAt).toLocaleString()}`));$('equipment-history').append(li);}
    if(renderedProject!==state.projectId){$('equipment-file').value='';renderedProject=state.projectId;}
    if(renderedInventory!==state.inventory){renderedInventory=state.inventory;if(reservation && regionId==='new-york')renderSite($('nyc-detail'),reservation);document.dispatchEvent(new CustomEvent('equipmentinventorychange'));}
  });
  $('equipment-file').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;
    const token=vm.stageFile(file.name);
    try{if(file.size>2000000)throw Error('Select a UTF-8 equipment JSON file up to 2 MB.');const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());if(vm.getState()===token)await vm.preview(raw,file.name);}
    catch(error){if(vm.getState()===token)vm.fail(error instanceof TypeError ? 'Equipment file must use UTF-8 text encoding.' : error.message);}
  };
  $('equipment-reload').onclick=()=>vm.load(getProject()?.id || null).catch(()=>{});
  $('equipment-repreview').onclick=()=>vm.preview(vm.getState().raw,vm.getState().fileName).catch(()=>{});
  $('equipment-import').onclick=()=>vm.commit().catch(()=>{});
  document.addEventListener('projectcontextchange',()=>vm.load(getProject()?.id || null).catch(()=>{}));
  document.addEventListener('reservationselected',event=>{reservation=event.detail;renderSite($('nyc-detail'),reservation);});
  vm.load(getProject()?.id || null).catch(()=>{});
  return {renderSite,getInventory:()=>vm.getState().projectId===getProject()?.id?vm.getState().inventory:null};
}
