import {validateTemplate,peakEirp} from './planning-model.mjs';
import {validateCarrier} from './carrier-plan.mjs';
import {qualifyGrid,refreshGridGain} from './pattern-study.mjs';
import {equipmentStudyPath,equipmentStudyTemplate} from './equipment-study.mjs';

export const CELL_RADIO_FIELDS=Object.freeze(['rat','frequencyMHz','bandwidthMHz','carrier','mode']);
const ids=/^[A-Za-z0-9_-]{1,64}$/;
export function powerSum(values){if(!values.length)return null;const maximum=Math.max(...values);return maximum+10*Math.log10(values.reduce((sum,value)=>sum+10**((value-maximum)/10),0));}

export function asCellStudy(draft){
 const result=structuredClone(draft);if(result.assignmentMode==='cells')return result;
 delete result.template.equipmentSource;
 return {...result,assignmentMode:'cells',overrides:{},cells:[],radioBudgets:{}};
}

export function cellStudyPaths(draft,inventory){
 if(!Array.isArray(draft.cells) || draft.cells.length>1000)throw Error('Assign at most 1,000 source cells.');
 const seen=new Set();let count=0;
 if(!draft.cells.length)return [];
 if(!inventory)throw Error('Load the original equipment revision to review assigned cells.');
 const tables=Object.fromEntries(Object.entries(inventory.data).filter(([,rows])=>Array.isArray(rows)).map(([kind,rows])=>[kind,new Map(rows.map(r=>[r.id,r]))]));
 const lookup=(kind,id)=>tables[kind]?.get(id);
 return draft.cells.map(assignment=>{
  if(!assignment || Object.keys(assignment).sort().join(',')!=='cellId,ports' || !ids.test(assignment.cellId || ''))throw Error('Each assigned cell needs its source ID and port templates.');
  if(seen.has(assignment.cellId))throw Error('An imported cell can be assigned only once.');seen.add(assignment.cellId);
  if(!Array.isArray(assignment.ports) || !assignment.ports.length || assignment.ports.length>64)throw Error('Each cell needs 1 to 64 source port paths.');
  count+=assignment.ports.length;if(count>4096)throw Error('Assign at most 4,096 source port paths.');
  const sourceCell=lookup('cells',assignment.cellId),sector=lookup('sectors',sourceCell?.sectorId),site=lookup('sites',sector?.siteId);
  const ports=assignment.ports.map(template=>{
   if(template?.equipmentSource?.cellId!==assignment.cellId)throw Error('Every port must identify its assigned source cell.');
   return {...equipmentStudyPath(inventory,template.equipmentSource,site?.inventorySiteId,{allowHistorical:true,lookup}),template};
  });
  return {cellId:assignment.cellId,cell:sourceCell,sector,site,radio:ports[0].radio,ports};
 });
}

function budgetKeys(paths){return [...new Set(paths.flatMap(cell=>cell.ports.map(p=>p.radio.id)))];}
function pruneBudgets(draft,paths){return Object.fromEntries(budgetKeys(paths).map(id=>[id,Object.hasOwn(draft.radioBudgets || {},id)?draft.radioBudgets[id]:null]));}

export function addSourceCell(draft,inventory,cellId,linkIds){
 const result=asCellStudy(draft),cell=inventory?.data.cells.find(c=>c.id===cellId),sector=inventory?.data.sectors.find(s=>s.id===cell?.sectorId),site=inventory?.data.sites.find(s=>s.id===sector?.siteId);
 if(!cell || !site)throw Error('Choose a cell in this project equipment inventory.');
 const selected=linkIds || inventory.data.links.filter(link=>link.cellId===cellId).map(link=>link.id);
 if(!selected.length)throw Error('This cell has no reported radio-port/antenna-port link.');
 if(new Set(selected).size!==selected.length)throw Error('Choose each source port link once.');
 const existing=result.cells.find(c=>c.cellId===cellId),newLinks=selected.filter(id=>!existing?.ports.some(p=>p.equipmentSource.linkId===id));
 if(!newLinks.length)throw Error('These cell ports are already assigned.');
 if(result.cells.length)cellStudyPaths(result,inventory);
 const ports=newLinks.map(linkId=>{
  const template=equipmentStudyTemplate(existing?.ports[0] || result.template,inventory,cellId,linkId,site.inventorySiteId);
  if(existing)for(const key of CELL_RADIO_FIELDS){if(Object.hasOwn(existing.ports[0],key))template[key]=structuredClone(existing.ports[0][key]);else delete template[key];}
  return template;
 });
 if(existing)existing.ports.push(...ports);else result.cells.push({cellId,ports});
 result.radioBudgets=pruneBudgets(result,cellStudyPaths(result,inventory));return result;
}

export function updateCellPort(draft,cellId,linkId,template,inventory){
 const result=structuredClone(draft),cell=result.cells.find(c=>c.cellId===cellId),port=cell?.ports.find(p=>p.equipmentSource.linkId===linkId);
 if(!port || template.equipmentSource?.cellId!==cellId || template.equipmentSource?.linkId!==linkId)throw Error('Select an assigned source cell and port before editing.');
 for(const target of cell.ports)for(const key of CELL_RADIO_FIELDS){if(Object.hasOwn(template,key))target[key]=structuredClone(template[key]);else delete target[key];}
 cell.ports[cell.ports.indexOf(port)]=structuredClone(template);cell.ports=cell.ports.map(p=>refreshGridGain(p,inventory));return result;
}

export function removeCellPort(draft,inventory,cellId,linkId){
 const result=structuredClone(draft);result.cells=result.cells.map(c=>c.cellId===cellId?{...c,ports:c.ports.filter(p=>p.equipmentSource.linkId!==linkId)}:c).filter(c=>c.ports.length);
 result.radioBudgets=pruneBudgets(result,cellStudyPaths(result,inventory));return result;
}

export function setRadioBudget(draft,radioId,value){
 if(!Object.hasOwn(draft.radioBudgets || {},radioId))throw Error('Choose an assigned radio budget.');
 if(value!==null && (!Number.isFinite(value) || value < -30 || value > 80))throw Error('Radio budget must be -30 to 80 dBm or explicit unknown.');
 return {...draft,radioBudgets:{...draft.radioBudgets,[radioId]:value}};
}

export function splitRadioBudget(draft,inventory,radioId){
 const paths=cellStudyPaths(draft,inventory),ports=paths.flatMap(cell=>cell.ports).filter(p=>p.radio.id===radioId),budget=draft.radioBudgets?.[radioId];
 if(!ports.length || !Number.isFinite(budget) || budget < -30 || budget > 80)throw Error('Enter a valid modeled radio budget before splitting power.');
 const power=budget-10*Math.log10(ports.length);if(power < -30 || power > 80)throw Error('This budget cannot be split within the supported per-port power range.');
 const links=new Set(ports.map(p=>p.link.id)),result=structuredClone(draft);
 for(const cell of result.cells)for(const port of cell.ports)if(links.has(port.equipmentSource.linkId))port.powerDbm=power;
 return result;
}

export function rebuildCellSources(draft,inventory){
 const result=structuredClone(draft);result.cells=result.cells.map(cell=>({cellId:cell.cellId,ports:cell.ports.map(port=>{
  const source=inventory.data.cells.find(c=>c.id===cell.cellId),sector=inventory.data.sectors.find(s=>s.id===source?.sectorId),site=inventory.data.sites.find(s=>s.id===sector?.siteId);
  return equipmentStudyTemplate(port,inventory,cell.cellId,port.equipmentSource.linkId,site?.inventorySiteId);
 })}));result.radioBudgets=pruneBudgets(result,cellStudyPaths(result,inventory));return result;
}

export function validateCellStudy(draft,inventory,{qualified=false,currentInventory=inventory}={}){
 try{
  if(draft.assignmentMode!=='cells' || Object.keys(draft.overrides || {}).length || draft.template.equipmentSource)throw Error('Source cell mode cannot mix site overrides or source-linked defaults.');
  const paths=cellStudyPaths(draft,inventory),powers=new Map(),occupied=new Map(),radioEnds=new Map(),antennaEnds=new Map();
  if(qualified && !paths.length)throw Error('Assign at least one imported cell and its ports.');
  if(qualified && (!currentInventory || currentInventory.revision!==inventory?.revision || currentInventory.sha256!==inventory?.sha256 || !currentInventory.currentSourceFingerprint || currentInventory.sourceFingerprint!==currentInventory.currentSourceFingerprint))throw Error('Equipment source changed. Rebuild reviewed assignments from the current source before execution.');
  for(const cell of paths){
   let common;const radioPorts=new Set(),antennaPorts=new Set();
   for(const port of cell.ports){
    const t=port.template,error=validateTemplate(t) || (qualified?validateCarrier(t,true):'');if(error)throw Error(`${cell.cell.cellIdentity || cell.cellId} / ${port.radioPort.name || port.radioPort.id} → ${port.antennaPort.name || port.antennaPort.id}: ${error}`);
    if(t.pattern==='sampled')qualifyGrid(inventory,port,t);
    if(t.rat!==cell.cell.rat)throw Error('Assigned RAT must match the imported cell RAT.');
    const values=[t.rat,t.frequencyMHz,t.bandwidthMHz,t.mode,...['standard','band','channel','scsKHz'].map(k=>t.carrier?.[k])];
    if(common && values.some((v,i)=>v!==common[i]))throw Error('All ports of a cell must share RAT, carrier, bandwidth and environment.');common=values;
    const rp=port.radioPort.id,ap=port.antennaPort.id;
    if(radioPorts.has(rp)||antennaPorts.has(ap))throw Error('A cell cannot count the same physical port twice.');radioPorts.add(rp);antennaPorts.add(ap);
    if((radioEnds.has(rp)&&radioEnds.get(rp)!==ap)||(antennaEnds.has(ap)&&antennaEnds.get(ap)!==rp))throw Error('Splitter/combiner paths are unsupported; use one-to-one endpoints.');radioEnds.set(rp,ap);antennaEnds.set(ap,rp);
    const low=t.frequencyMHz-t.bandwidthMHz/2,high=t.frequencyMHz+t.bandwidthMHz/2;
    if((occupied.get(rp)||[]).some(([a,b])=>Math.max(a,low)<Math.min(b,high)-1e-9))throw Error(`Radio port ${rp} has overlapping cell carriers.`);
    occupied.set(rp,[...(occupied.get(rp)||[]),[low,high]]);powers.set(port.radio.id,[...(powers.get(port.radio.id)||[]),t.powerDbm]);
   }
   if(qualified){const bound=powerSum(cell.ports.map(p=>peakEirp(p.template)));if(bound<0 || bound>90)throw Error('Cell EIRP upper bound must be 0 to 90 dBm for route execution.');}
  }
  if(!draft.radioBudgets || typeof draft.radioBudgets!=='object' || Array.isArray(draft.radioBudgets) || Object.keys(draft.radioBudgets).length!==powers.size || [...powers.keys()].some(id=>!Object.hasOwn(draft.radioBudgets,id)))throw Error('Provide one modeled budget or explicit unknown for every assigned radio.');
  for(const [radio,values]of powers){const budget=draft.radioBudgets[radio];if(budget===null){if(qualified)throw Error(`Radio ${radio}: enter a modeled conducted-power budget.`);continue;}if(!Number.isFinite(budget)||budget < -30||budget > 80)throw Error('Radio budget must be -30 to 80 dBm or explicit unknown.');if(powerSum(values)>budget+1e-9)throw Error(`Radio ${radio}: allocated power exceeds its modeled budget.`);}
  return '';
 }catch(error){return error.message;}
}
