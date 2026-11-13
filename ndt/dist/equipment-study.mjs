export function validateEquipmentReference(reference){
 if(!reference || typeof reference!=='object' || Array.isArray(reference) || Object.keys(reference).sort().join(',')!=='cellId,linkId,revision,sha256')return 'Equipment source needs a revision, hash, cell and link.';
 if(!Number.isInteger(reference.revision) || reference.revision<1 || reference.revision>50)return 'Invalid equipment source revision.';
 if(typeof reference.sha256!=='string' || !/^[a-f0-9]{64}$/.test(reference.sha256))return 'Invalid equipment source hash.';
 if(!['cellId','linkId'].every(key=>typeof reference[key]==='string' && /^[A-Za-z0-9_-]{1,64}$/.test(reference[key])))return 'Invalid equipment cell or link ID.';
 return '';
}

export function equipmentStudyPath(inventory,reference,siteId,{allowHistorical=false,lookup=null}={}){
 const error=validateEquipmentReference(reference);if(error)throw Error(error);
 if(!inventory || inventory.revision!==reference.revision || inventory.sha256!==reference.sha256 || (!allowHistorical && inventory.currentSourceFingerprint && inventory.sourceFingerprint!==inventory.currentSourceFingerprint))throw Error('Equipment source changed. Re-link reviewed equipment or keep the study as assumptions.');
 const data=inventory.data,find=lookup || ((kind,id)=>data?.[kind]?.find(record=>record.id===id));
 const cell=find('cells',reference.cellId),link=find('links',reference.linkId),sector=find('sectors',cell?.sectorId),site=find('sites',sector?.siteId);
 const rp=find('ports',link?.radioPortId),ap=find('ports',link?.antennaPortId),radio=find('radios',rp?.equipmentId),antenna=find('antennas',ap?.equipmentId);
 if(!cell || !link || link.cellId!==cell.id || !sector || !site || site.inventorySiteId!==siteId || rp?.role!=='radio' || ap?.role!=='antenna' || !radio || !antenna || radio.id!==cell.radioId || radio.siteId!==site.id || antenna.siteId!==site.id)throw Error('Equipment source needs an explicit cell/radio/port/antenna path at this site.');
 return {cell,link,sector,site,radio,radioPort:rp,antennaPort:ap,antenna,pattern:find('patterns',(inventory.data.schemaVersion===2?ap.patternId:null) || antenna.patternId)};
}

export function equipmentStudyValues(inventory,reference,siteId,options){
 const {cell,sector,antenna}=equipmentStudyPath(inventory,reference,siteId,options);
 return {rat:cell.rat,frequencyMHz:cell.frequencyMHz ?? null,bandwidthMHz:cell.bandwidthMHz ?? null,azimuthDeg:sector.azimuthDeg ?? null,gainDbi:antenna.gainDbi ?? null,tiltDeg:antenna.tiltDeg ?? null};
}

export function equipmentStudyTemplate(base,inventory,cellId,linkId,siteId){
 const reference={revision:inventory.revision,sha256:inventory.sha256,cellId,linkId},reported=equipmentStudyValues(inventory,reference,siteId);
 const {carrier,equipmentSource,array,sampled,polarization,...assumptions}=base;
 // Reported frequencies may be rounded; require an explicit band/channel review after copying.
 return {...assumptions,...reported,pattern:'element',equipmentSource:reference};
}
