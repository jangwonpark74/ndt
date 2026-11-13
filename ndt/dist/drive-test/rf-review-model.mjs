import {antennaAttenuation,receiverAntennaAttenuation,farFieldDistance,peakEirp,validateTemplate} from '../planning-model.mjs';
import {umaPathLoss} from '../radio-model.mjs';
import {prepareGrid} from '../pattern-model.mjs';
import {qualifyGrid,sourceGrid} from '../pattern-study.mjs';
import {RECEIVER_MODEL,validateReceiverTemplates,preparePolarization,templateOrientation} from '../polarization-model.mjs';

import {RF_MODELS} from './rf-review-summary.mjs';
export {RF_MODELS,RF_REASONS,summarizeReview} from './rf-review-summary.mjs';
const rad=Math.PI/180,tolerance=1e-7;
const sum=values=>10*Math.log10(values.reduce((n,p)=>n+10**(p/10),0));
const rat=t=>t.ports?t.rat:t.template?.rat;
const portRows=t=>t.ports || [{linkId:null,template:t.template}];
const bound=t=>sum(portRows(t).map(p=>peakEirp(p.template)));
const finite=(n,low,high,label)=>{if(!Number.isFinite(n)||n<low||n>high)throw Error(`Invalid frozen ${label}.`);return n;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function rfDistance(a,b){const a1=a[1]*rad,b1=b[1]*rad,h=Math.sin((b1-a1)/2)**2+Math.cos(a1)*Math.cos(b1)*Math.sin((b[0]-a[0])*rad/2)**2;return 2*6371000*Math.asin(Math.min(1,Math.sqrt(h)));}
function bearing(a,b){const x=a[1]*rad,y=b[1]*rad,d=(b[0]-a[0])*rad;return (Math.atan2(Math.sin(d)*Math.cos(y),Math.cos(x)*Math.sin(y)-Math.sin(x)*Math.cos(y)*Math.cos(d))/rad+360)%360;}
function coordinates(c){if(!Array.isArray(c)||c.length<2)throw Error('Missing frozen coordinates.');finite(c[0],-180,180,'longitude');finite(c[1],-90,90,'latitude');}
const sha=async raw=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(v=>v.toString(16).padStart(2,'0')).join('');

async function patternAssets(c){
 const assets=new Map(),equipment=c.inventorySnapshot?.operatorEquipment,models=c.patternModels;let inventory=null;
 if(equipment){if(typeof equipment.raw!=='string'||new TextEncoder().encode(equipment.raw).length>2000000||await sha(equipment.raw)!==equipment.sha256)throw Error('Frozen source hash does not match the original equipment bytes.');inventory={...equipment,data:JSON.parse(equipment.raw.replace(/^\uFEFF/,''))};}
 const model=c.predictionModel||c.model;
 if(model!==RF_MODELS[4]&&!(model===RF_MODELS[5]&&(c.patternModels?.length||c.transmitters.some(t=>portRows(t).some(p=>p.template?.pattern==='sampled')))))return {assets,inventory};
 if(!inventory||!Array.isArray(models)||!models.length||!c.patternAssumptions)throw Error('Missing frozen source pattern qualification.');
 if(inventory.data.schemaVersion!==2)throw Error('Frozen source grids require equipment schema version 2.');
 const active=c.transmitters.flatMap(t=>portRows(t)).filter(p=>p.template?.pattern==='sampled');
 for(const model of models){
  if(assets.has(model.patternId)||model.equipmentRevision!==equipment.revision||model.equipmentSha256!==equipment.sha256)throw Error('Frozen source model identity does not match.');
  const pattern=inventory.data.patterns.find(p=>p.id===model.patternId),r=pattern?.radiation;if(!r)throw Error('Frozen source pattern is missing.');
  const selected=active.find(p=>p.template.sampled.patternId===model.patternId),grid=selected?sourceGrid(inventory,selected.template.equipmentSource).grid:prepareGrid(r);
  for(const key of ['format','antennaModel','portNames','electricalState','electricalTiltDeg','referenceImpedanceOhm','portConditions','maxDimensionM','coordinateSystem','referencePlane','frequencyMHz'])if(!same(model[key],r[key]))throw Error(`Frozen source ${key} does not match its original model.`);
  if(model.independentlyVerified!==false||model.sampleCount!==grid.sampleCount||model.peakGainDbi.length!==r.frequencyMHz.length||model.efficiencies.length!==r.frequencyMHz.length)throw Error('Frozen numerical source qualification does not match.');
  for(let i=0;i<r.frequencyMHz.length;i++)if(Math.abs(model.peakGainDbi[i]-grid.peakGainDbi(r.frequencyMHz[i]))>1e-8||Math.abs(model.efficiencies[i]-grid.efficiencies[i])>1e-8)throw Error('Frozen numerical source qualification does not match.');
  assets.set(model.patternId,grid);
 }
 return {assets,inventory};
}

export async function prepareReview(test){
 const c=test?.context,model=c?.predictionModel || c?.model;
 if(test?.kind!=='simulated'||!c||!RF_MODELS.includes(model)||c.model&&c.model!==model)throw Error('RF review needs an available frozen planning model; measured and synthetic captures have no executable RF context.');
 const version=RF_MODELS.indexOf(model),cellMode=version>=3,legacy=version===0;
 const allTemplates=c.transmitters?.flatMap(t=>portRows(t).map(p=>p.template).filter(Boolean))||[];
 if(version!==5&&(c.radioScenario?.payload?.receiver||c.receiverAssumptions||allTemplates.some(t=>Object.hasOwn(t,'polarization'))))throw Error('Receiver and polarization inputs require their matching frozen model identity.');
 if(version===5&&c.receiverAssumptions?.model!==RECEIVER_MODEL)throw Error('Frozen receiver assumptions are missing or unavailable.');
 if(Boolean(c.radioScenario)===legacy)throw Error('Frozen model and scenario identity do not match.');
 if(!Array.isArray(test.rows)||!test.rows.length||test.rows.length>100000||!Array.isArray(c.transmitters)||!c.transmitters.length||c.transmitters.length>1000||!['LTE','NR'].includes(c.rat))throw Error('Frozen RF inputs exceed the supported run bounds.');
 if(legacy&&!['LOS','NLOS'].includes(c.mode))throw Error('Invalid frozen propagation mode.');
 const {assets,inventory}=await patternAssets(c),ids=new Set(),totals=new Map();let ports=0;
 for(const t of c.transmitters){
  if(typeof t.id!=='string'||!t.id||ids.has(t.id))throw Error('Duplicate or missing frozen transmitter identity.');ids.add(t.id);coordinates(t.coordinates);finite(c.powers?.[t.id],0,90,'effective EIRP');
  if(legacy){finite(t.frequency_mhz,1,1000000,'frequency');continue;}
  const paths=portRows(t);if(!paths.length||paths.length>64||t.ports&&!cellMode)throw Error('Frozen cell paths require their source-cell model identity.');ports+=paths.length;
  const links=new Set();let common=null;const delta=cellMode?c.powers[t.id]-bound(t):0;
  for(const p of paths){
   const template=p.template;if(!template)throw Error('Missing frozen port template.');const {carrier,...numeric}=template,error=validateTemplate(numeric);if(error)throw Error(error);
   if(version===1&&template.pattern==='array'||![4,5].includes(version)&&template.pattern==='sampled')throw Error('Antenna inputs require their matching frozen model identity.');
   if(t.ports){
    const ref=template.equipmentSource;if(!ref||ref.cellId!==t.cellId||ref.linkId!==p.linkId||template.rat!==t.rat||links.has(p.linkId))throw Error('Frozen cell/port identity does not match.');links.add(p.linkId);
    const values=[template.rat,template.frequencyMHz,template.bandwidthMHz,template.mode,template.carrier];if(common&&!same(common,values))throw Error('Frozen cell ports have inconsistent radio inputs.');common=values;
    const power=finite(template.powerDbm+delta,-30,80,'conducted port allocation');totals.set(p.radioId,(totals.get(p.radioId)||0)+10**(power/10));
   }
   if(template.pattern==='sampled'){
    if(!assets.has(template.sampled.patternId))throw Error('Source pattern qualification is missing.');
    const candidate=sourceGrid(inventory,template.equipmentSource);if(t.site_id!==candidate.path.site.inventorySiteId||t.cellId!==candidate.path.cell.id||p.radioId!==candidate.path.radio.id||p.radioPortId!==candidate.path.radioPort.id||p.antennaPortId!==candidate.path.antennaPort.id||p.antennaId!==candidate.path.antenna.id)throw Error('Frozen physical pattern path does not match.');
    qualifyGrid(inventory,candidate.path,template);
   }
  }
 }
 if(ports>4096)throw Error('Frozen port count exceeds 4096.');
 if(totals.size){const budgets=c.radioScenario.payload.radioBudgets;if(!budgets||Object.keys(budgets).length!==totals.size)throw Error('Frozen radio budgets are incomplete.');for(const [radio,mw]of totals)if(10*Math.log10(mw)>finite(budgets[radio],-30,80,'radio budget')+1e-8)throw Error('Frozen allocations exceed their radio budget.');}
 let previous=-Infinity;for(const row of test.rows){coordinates([row.longitude,row.latitude]);if(!Number.isSafeInteger(row.t)||row.t<=previous||row.rat!==c.rat)throw Error('Frozen observations have an inconsistent time/coordinate/RAT grid.');previous=row.t;if(row.predicted_rx_dbm!==undefined)finite(row.predicted_rx_dbm,-300,90,'recorded received power');}
 const transmitters=c.transmitters.filter(t=>legacy||rat(t)===c.rat);if(!transmitters.length)throw Error('The frozen run has no transmitter for its RAT.');
 let receiver=null;const polarizations=new Map();
 if(version===5){
  const payload=c.radioScenario.payload;
  if(Object.hasOwn(payload,'receiver')&&payload.receiver===null)throw Error('A declared frozen receiver must be explicit.');
  receiver=validateReceiverTemplates(payload.receiver,allTemplates);
  if(receiver)for(const t of allTemplates)polarizations.set(t,preparePolarization(templateOrientation(t)));
 }
 return {test,context:c,model,version,cellMode,legacy,assets,inventory,transmitters,receiver,polarizations,evaluations:test.rows.length*transmitters.reduce((n,t)=>n+(t.ports?.length||1),0)};
}

function cellAt(prepared,t,row){
 const {context:c,legacy,cellMode,version,assets}=prepared,receiver=[row.longitude,row.latitude],distanceM=rfDistance(receiver,t.coordinates),slantM=Math.hypot(distanceM,23.5),az=bearing(t.coordinates,receiver),elevation=Math.atan2(-23.5,distanceM)/rad;
 const paths=[],delta=cellMode?c.powers[t.id]-bound(t):0;
 for(const p of legacy?[{linkId:null,template:null}]:portRows(t)){
  const template=p.template,frequency=legacy?t.frequency_mhz:template.frequencyMHz,mode=legacy?c.mode:template.mode,boundary=legacy?0:farFieldDistance(template,assets),loss=umaPathLoss(distanceM,frequency,mode);
  let status='supported';
  // v3 historically checked far field before the path-loss domain; retain that order.
  if(version===2&&slantM<boundary)status='near-field';else if(loss===null)status='model-domain';else if(cellMode&&slantM<boundary)status='near-field';
  const attenuation=status==='supported'&&!legacy?(prepared.receiver?receiverAntennaAttenuation(template,az-template.azimuthDeg,elevation,assets):antennaAttenuation(template,az-template.azimuthDeg,elevation,assets)):null,eirp=cellMode?peakEirp(template)+delta:c.powers[t.id],scalarRx=status==='supported'?eirp-loss-(attenuation||0):null;
  let rx=scalarRx,collected=null;
  if(status==='supported'&&prepared.receiver){collected=prepared.receiver.coupling(prepared.polarizations.get(template),az,elevation);if(collected.powerFraction)rx+=10*Math.log10(collected.powerFraction);else{status='polarization-null';rx=null;}}
  paths.push({linkId:p.linkId??null,radioId:p.radioId??null,radioPortId:p.radioPortId??null,antennaPortId:p.antennaPortId??null,pattern:template?.pattern||'isotropic',status,rxDbm:rx,pathLossDb:loss,attenuationDb:attenuation,eirpDbm:eirp,farFieldM:boundary,...(collected?{scalarRxDbm:scalarRx,receiver:collected}:{})});
 }
 const failed=paths.find(p=>!['supported','polarization-null'].includes(p.status)),values=paths.map(p=>p.rxDbm).filter(v=>v!==null);let status=failed?.status||'supported',rxDbm=failed?null:cellMode?(values.length?sum(values):null):paths[0].rxDbm;
 if(!failed&&!values.length)status='below-output';
 if((cellMode||version===2)&&rxDbm!==null&&rxDbm < -300){status='below-output';rxDbm=null;}
 return {id:t.id,label:t.label||t.id,coordinates:t.coordinates,siteId:t.site_id||t.id,cellId:t.cellId??null,status,rxDbm,distanceM,slantM,bearingDeg:az,elevationDeg:elevation,blockedPathId:failed?.linkId??null,paths,...(prepared.receiver?{zeroCollectedPower:!failed&&!values.length}:{})};
}
function position(prepared,row){
 const cells=prepared.transmitters.map(t=>cellAt(prepared,t,row)),available=cells.filter(c=>c.status==='supported'),best=available.reduce((a,b)=>!a||b.rxDbm>a.rxDbm?b:a,null),recorded=row.cell_id?.startsWith('PLAN:')?row.cell_id.slice(5):null;
 let error=0;if(Number.isFinite(row.predicted_rx_dbm)){
  const winner=available.find(c=>c.id===recorded);error=winner?Math.max(Math.abs(winner.rxDbm-row.predicted_rx_dbm),Math.abs(best.rxDbm-row.predicted_rx_dbm)):Infinity;
  if(error>tolerance)throw Error('Frozen-model replay does not match the recorded received power or serving identity.');
 }else if(best)throw Error('Frozen-model replay produced power where the recorded prediction is unavailable.');
 const status=best?'supported':cells.some(c=>c.status==='below-output')?'below-output':cells.some(c=>c.status==='near-field')?'near-field':'model-domain';
 return {cells,serving:available.find(c=>c.id===recorded)||best,status,error};
}
function select(at,target){
 const cell=target?.cellId?at.cells.find(c=>c.id===target.cellId):at.serving;
 if(!cell)return {status:target?.cellId?'not-assigned':at.status,rxDbm:null,cellId:null,linkId:target?.linkId??null};
 const result={status:cell.status,rxDbm:cell.rxDbm,cellId:cell.id,linkId:target?.linkId??null,distanceM:cell.distanceM,blockedPathId:cell.blockedPathId,...(cell.zeroCollectedPower!==undefined?{zeroCollectedPower:cell.zeroCollectedPower}:{})};
 if(target?.linkId){
  const path=cell.paths.find(p=>p.linkId===target.linkId);if(!path)return {...result,status:'not-assigned',rxDbm:null};
  const complete=cell.status==='supported'||cell.zeroCollectedPower,knownPath=['supported','polarization-null'].includes(path.status),zero=path.receiver?.powerFraction===0;
  return {...result,status:knownPath&&!complete?(cell.status==='below-output'?'below-output':'cell-incomplete'):path.status,componentRxDbm:path.rxDbm,rxDbm:cell.status==='supported'&&path.status==='supported'?path.rxDbm:null,...(path.receiver?{scalarRxDbm:path.scalarRxDbm,receiverPowerFraction:path.receiver.powerFraction,zeroCollectedPower:!!complete&&zero,componentZeroCollectedPower:zero}:{})};
 }
 return result;
}
function paired(a,b){
 if(!b)return;const c=a.context,d=b.context;
 if(a.test.id===b.test.id||!c.experiment_id||c.experiment_id!==d.experiment_id||!c.id||c.id!==d.id||c.variant===d.variant||!['A','B'].includes(c.variant)||!['A','B'].includes(d.variant)||!same(c.case,d.case)||!same(c.route,d.route)||c.rat!==d.rat||a.test.rows.length!==b.test.rows.length)throw Error('RF deltas require paired A/B members of the same frozen experiment and speed case.');
 for(let i=0;i<a.test.rows.length;i++){const x=a.test.rows[i],y=b.test.rows[i];if(x.t!==y.t||x.longitude!==y.longitude||x.latitude!==y.latitude||x.chainage_m!==y.chainage_m)throw Error('Paired RF results do not share the same observation grid.');}
}
export function reviewTargets(current,reference){
 const targets=new Map();for(const [side,p]of [['current',current],['reference',reference]])for(const t of p?.transmitters||[]){
  if(!targets.has(t.id))targets.set(t.id,{id:t.id,label:t.label||t.id,siteId:t.site_id||t.id,ports:[],current:false,reference:false});const entry=targets.get(t.id);entry[side]=true;
  for(const path of t.ports||[]){if(entry.ports.some(p=>p.id===path.linkId))continue;const rp=p.inventory?.data.ports.find(x=>x.id===path.radioPortId),ap=p.inventory?.data.ports.find(x=>x.id===path.antennaPortId);entry.ports.push({id:path.linkId,label:`${rp?.name||path.radioPortId} → ${ap?.name||path.antennaPortId} / ${path.linkId}`});}
 }return [...targets.values()];
}
export async function reviewTrace({current,reference=null,target=null,onProgress=()=>{}}){
 paired(current,reference);const evaluations=current.evaluations+(reference?.evaluations||0);if(evaluations>200000000||(current.cellMode&&current.evaluations>20000000)||(reference?.cellMode&&reference.evaluations>20000000))throw Error('Frozen review exceeds the execution work bounds.');
 if(target?.cellId||target?.linkId){const choice=reviewTargets(current,reference).find(t=>t.id===target.cellId);if(!choice||target.linkId&&!choice.ports.some(p=>p.id===target.linkId))throw Error('Choose a cell/site and port in the frozen assignments.');}
 const rows=[];let maxAbsDb=0;
 for(let index=0;index<current.test.rows.length;index++){
  const row=current.test.rows[index],a=position(current,row),b=reference?position(reference,reference.test.rows[index]):null,x=select(a,target),y=b?select(b,target):null;maxAbsDb=Math.max(maxAbsDb,a.error,b?.error||0);
  rows.push({index,t:row.t,longitude:row.longitude,latitude:row.latitude,chainage_m:row.chainage_m,current:x,reference:y,deltaDb:y&&x.rxDbm!==null&&y.rxDbm!==null?x.rxDbm-y.rxDbm:null,recordedCellId:row.cell_id??null,recordedRxDbm:row.predicted_rx_dbm??null});
  if(index%500===0)onProgress({done:index+1,total:current.test.rows.length});
 }
 onProgress({done:rows.length,total:rows.length});return {schema:'ndt.rf-review.v1',currentId:current.test.id,referenceId:reference?.test.id??null,target,models:[current.model,...(reference?[reference.model]:[])],verification:{maxAbsDb,toleranceDb:tolerance,observations:rows.length},rows};
}
export function reviewSample(current,reference,index,target){
 if(!Number.isInteger(index)||index<0||index>=current.test.rows.length)throw Error('Choose a valid frozen observation.');
 const inspect=(p)=>{if(!p)return null;const row=p.test.rows[index],at=position(p,row),selected=select(at,target),cell=at.cells.find(c=>c.id===selected.cellId);return {...cell,...selected,paths:cell?.paths||[],selectedLinkId:target?.linkId??null,servingId:at.serving?.id??null,unavailableCells:at.cells.filter(c=>c.status!=='supported').slice(0,20).map(c=>({id:c.id,label:c.label,status:c.status,blockedPathId:c.blockedPathId}))};};
 return {index,current:inspect(current),reference:inspect(reference)};
}
