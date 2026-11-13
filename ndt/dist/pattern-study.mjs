import {prepareGrid,GRID_MODEL} from './pattern-model.mjs';
import {equipmentStudyPath} from './equipment-study.mjs';
const prepared=new WeakMap();

export function validateSampledReference(template){
 if(template.pattern!=='sampled')return Object.hasOwn(template,'sampled')?'Sampled model inputs require the imported scalar-grid pattern.':'';
 const s=template.sampled;
 if(!s || typeof s!=='object' || Array.isArray(s) || Object.keys(s).sort().join(',')!=='format,patternId,rollDeg' || s.format!==GRID_MODEL || typeof s.patternId!=='string' || !/^[A-Za-z0-9_-]{1,64}$/.test(s.patternId))return 'Select a reviewed versioned scalar grid and mechanical roll.';
 if(!Number.isFinite(s.rollDeg) || s.rollDeg < -180 || s.rollDeg>180)return 'Enter mechanical roll between -180 and 180 degrees.';
 return template.equipmentSource?'':'An imported grid requires an explicit source cell and port path.';
}

export function inspectGrid(inventory,reference){
 if(inventory?.data.schemaVersion!==2)throw Error('Imported scalar-grid execution requires equipment schemaVersion 2.');
 const data=inventory.data,cell=data.cells.find(c=>c.id===reference?.cellId),sector=data.sectors.find(s=>s.id===cell?.sectorId),site=data.sites.find(s=>s.id===sector?.siteId),path=equipmentStudyPath(inventory,reference,site?.inventorySiteId,{allowHistorical:true}),pattern=path.pattern,r=pattern?.radiation;
 if(!r)throw Error('A full-sphere scalar grid is not reported for this port; two cuts remain inspection data.');
 if(!prepared.has(inventory))prepared.set(inventory,new Map());const cache=prepared.get(inventory);
 if(!cache.has(pattern.id))cache.set(pattern.id,prepareGrid(r));
 return {path,pattern,grid:cache.get(pattern.id)};
}

export function sourceGrid(inventory,reference){
 const candidate=inspectGrid(inventory,reference),{path,pattern}=candidate,r=pattern.radiation;
 if(path.antenna.model!==r.antennaModel)throw Error('The source antenna model does not match the pattern declared hardware model.');
 if(!r.portNames.includes(path.antennaPort.name))throw Error('The physical antenna port name is not declared for this source pattern.');
 return candidate;
}

export function qualifyGrid(inventory,path,template){
 const error=validateSampledReference(template);if(error)throw Error(error);
 if(template.equipmentSource?.cellId!==path.cell.id || template.equipmentSource?.linkId!==path.link.id)throw Error('The source cell/link does not match the pattern path.');
 const candidate=sourceGrid(inventory,template.equipmentSource);
 if(template.sampled.patternId!==candidate.pattern.id)throw Error('Choose the pattern explicitly linked to this antenna port.');
 candidate.grid.checkCarrier(template.frequencyMHz,template.bandwidthMHz);
 if(!Number.isFinite(template.gainDbi) || Math.abs(template.gainDbi-candidate.grid.peakGainDbi(template.frequencyMHz))>1e-9)throw Error('Source-grid peak gain must equal its derived frequency-dependent upper bound; do not add antenna or array gain.');
 return candidate.grid;
}

export function applySourceGrid(template,inventory){
 const {path,pattern,grid}=sourceGrid(inventory,template.equipmentSource);grid.checkCarrier(template.frequencyMHz,template.bandwidthMHz);
 const {array,sampled,...base}=template;
 const same=template.pattern==='sampled' && template.sampled?.patternId===pattern.id;
 return {...base,pattern:'sampled',gainDbi:grid.peakGainDbi(base.frequencyMHz),tiltDeg:same?template.tiltDeg:path.antenna.mechanicalTiltDeg ?? NaN,
  sampled:{format:GRID_MODEL,patternId:pattern.id,rollDeg:same?template.sampled.rollDeg:path.antenna.mechanicalRollDeg ?? NaN}};
}

export function refreshGridGain(template,inventory){
 if(template.pattern!=='sampled')return template;
 try{const {pattern,grid}=sourceGrid(inventory,template.equipmentSource);if(template.sampled.patternId!==pattern.id)throw Error('Unlinked pattern');return {...template,gainDbi:grid.peakGainDbi(template.frequencyMHz)};}
 catch{return {...template,gainDbi:NaN};}
}

export function templateGridAssets(template,inventory){
 if(template.pattern!=='sampled')return null;
 const {pattern,grid}=sourceGrid(inventory,template.equipmentSource);
 if(template.sampled?.patternId!==pattern.id)throw Error('Choose the pattern explicitly linked to this antenna port.');
 return new Map([[pattern.id,grid]]);
}
