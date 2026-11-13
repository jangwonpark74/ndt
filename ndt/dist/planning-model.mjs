import {umaPathLoss} from './radio-model.mjs';
import {antennaPattern, sectorAzimuth} from './network-symbols.mjs';
import {validateCarrier} from './carrier-plan.mjs';
import {validateEquipmentReference} from './equipment-study.mjs';
import {validateSampledReference} from './pattern-study.mjs';
import {localDirection} from './pattern-model.mjs';

export const PLANNING_REFERENCE = 'https://www.etsi.org/deliver/etsi_tr/138900_138999/138901/18.00.00_60/tr_138901v180000p.pdf';
export const ARRAY_DEFAULTS=Object.freeze({rows:4,columns:4,verticalSpacing:.5,horizontalSpacing:.5,steerAzimuthDeg:0,steerDowntiltDeg:0});
export const ARRAY_BOUNDS=Object.freeze({rows:[1,64],columns:[1,64],verticalSpacing:[.25,1],horizontalSpacing:[.25,1],steerAzimuthDeg:[-90,90],steerDowntiltDeg:[-90,90]});
// Radio presets are editable study assumptions; 3GPP defines the element pattern, not these deployments.
export const RADIO_TEMPLATES = Object.freeze({
  lte: {name:'4G LTE macro study',rat:'LTE',frequencyMHz:2100,bandwidthMHz:20,powerDbm:40,gainDbi:8,lossDb:2,tiltDeg:6,azimuthDeg:0,pattern:'element',mode:'NLOS'},
  nr: {name:'5G NR macro study',rat:'NR',frequencyMHz:3500,bandwidthMHz:100,powerDbm:40,gainDbi:8,lossDb:2,tiltDeg:6,azimuthDeg:0,pattern:'element',mode:'NLOS'},
});

export function validateTemplate(t) {
  const bounds = {frequencyMHz:[500,100000],bandwidthMHz:[.1,400],powerDbm:[-30,80],gainDbi:t.pattern==='sampled'?[-120,50]:[0,40],lossDb:[0,40],tiltDeg:[-20,90],azimuthDeg:[0,359.999]};
  const labels={frequencyMHz:'carrier frequency (MHz)',bandwidthMHz:'bandwidth (MHz)',powerDbm:'TX power (dBm)',gainDbi:'peak gain (dBi)',lossDb:'feeder loss (dB)',tiltDeg:'downtilt (degrees)',azimuthDeg:'azimuth (degrees north)'};
  for (const [key,[low,high]] of Object.entries(bounds)) if (!Number.isFinite(t[key]) || t[key]<low || t[key]>high) return `Enter ${labels[key]} between ${low} and ${high}.`;
  if (!['LTE','NR'].includes(t.rat) || !['element','isotropic','array','sampled'].includes(t.pattern) || !['LOS','NLOS'].includes(t.mode)) return 'Select a supported RAT, antenna pattern and environment.';
  if(t.pattern==='array'){
    if(!t.array || typeof t.array!=='object' || Object.keys(t.array).length!==6)return 'Enter all six array geometry and steering inputs.';
    const arrayLabels={rows:'rows',columns:'columns',verticalSpacing:'vertical spacing (wavelengths)',horizontalSpacing:'horizontal spacing (wavelengths)',steerAzimuthDeg:'electrical azimuth offset (degrees)',steerDowntiltDeg:'electrical downtilt offset (degrees)'};
    for(const [key,[low,high]]of Object.entries(ARRAY_BOUNDS))if(!Number.isFinite(t.array[key]) || t.array[key]<low || t.array[key]>high || (['rows','columns'].includes(key) && !Number.isInteger(t.array[key])))return `Enter array ${arrayLabels[key]} between ${low} and ${high}${['rows','columns'].includes(key)?' as a whole number':''}.`;
  }else if(Object.hasOwn(t,'array'))return 'Array geometry requires the uniform panel array pattern.';
  if (t.bandwidthMHz >= t.frequencyMHz) return 'Bandwidth must be smaller than carrier frequency.';
  if (t.pattern === 'isotropic' && t.gainDbi !== 0) return 'An isotropic antenna requires 0 dBi gain.';
  return validateSampledReference(t) || validateCarrier(t) || (Object.hasOwn(t,'equipmentSource') ? validateEquipmentReference(t.equipmentSource) : '');
}

// Single panel, single polarization, uniform 1/sqrt(MN) weights; steering is in the panel frame.
export function arrayAttenuation(template,azimuthOffsetDeg,elevationDeg){
  const a=template.array,rad=Math.PI/180,az=azimuthOffsetDeg*rad,e=elevationDeg*rad,t=template.tiltDeg*rad;
  const y=Math.cos(e)*Math.sin(az),z=Math.sin(t)*Math.cos(e)*Math.cos(az)+Math.cos(t)*Math.sin(e);
  const steerAz=a.steerAzimuthDeg*rad,steerEl=-a.steerDowntiltDeg*rad;
  function amplitude(count,phase){const half=phase/2,den=Math.sin(half);return Math.abs(den)<1e-12?1:Math.min(1,Math.abs(Math.sin(count*half)/(count*den)));}
  const h=amplitude(a.columns,2*Math.PI*a.horizontalSpacing*(y-Math.cos(steerEl)*Math.sin(steerAz)));
  const v=amplitude(a.rows,2*Math.PI*a.verticalSpacing*(z-Math.sin(steerEl)));
  // Numerical floor for ideal coherent nulls, not a 3GPP propagation parameter.
  return Math.max(0,Math.min(120,-20*Math.log10(Math.max(1e-6,h*v))));
}

export function peakEirp(t){return t.powerDbm+t.gainDbi-t.lossDb+(t.pattern==='array'?10*Math.log10(t.array.rows*t.array.columns):0);}
export function arrayFarFieldDistance(t){const a=t.array;return 2*(((a.rows-1)*a.verticalSpacing)**2+((a.columns-1)*a.horizontalSpacing)**2)*3e8/(t.frequencyMHz*1e6);}
export function antennaAttenuation(t,azimuthOffsetDeg,elevationDeg,patternAssets){
 if(t.pattern==='sampled'){const grid=patternAssets?.get(t.sampled.patternId);if(!grid)throw Error('The imported scalar grid requires its qualified source model.');const [a,e]=localDirection(azimuthOffsetDeg,elevationDeg,t.tiltDeg,t.sampled.rollDeg);return grid.attenuation(t.frequencyMHz,a,e);}
 return t.pattern==='isotropic'?0:elementAttenuation(azimuthOffsetDeg,elevationDeg,t.tiltDeg)+(t.pattern==='array'?arrayAttenuation(t,azimuthOffsetDeg,elevationDeg):0);
}
export function farFieldDistance(t,patternAssets){if(t.pattern==='array')return arrayFarFieldDistance(t);if(t.pattern==='sampled'){const grid=patternAssets?.get(t.sampled.patternId);if(!grid)throw Error('Missing qualified source grid for far-field evaluation.');return grid.farFieldM(t.frequencyMHz);}return 0;}

// TR 38.901 v18.0.0 table 7.3-1. Rotate the direction into the downtilted element frame.
export function elementAttenuation(azimuthOffsetDeg, elevationDeg, tiltDeg = 0) {
  const rad = Math.PI/180, a=azimuthOffsetDeg*rad, e=elevationDeg*rad, t=tiltDeg*rad;
  const x=Math.cos(e)*Math.cos(a), y=Math.cos(e)*Math.sin(a), z=Math.sin(e);
  const localX=Math.cos(t)*x-Math.sin(t)*z, localZ=Math.sin(t)*x+Math.cos(t)*z;
  const phi=Math.atan2(y,localX)/rad, theta=Math.acos(Math.max(-1,Math.min(1,localZ)))/rad;
  return Math.min(30,Math.min(30,12*(phi/65)**2)+Math.min(30,12*((theta-90)/65)**2));
}

export function predictProbe(template, distanceM, bearingDeg,patternAssets) {
  const error=validateTemplate(template);
  if (error) return {error};
  const pathLoss=umaPathLoss(distanceM,template.frequencyMHz,template.mode);
  if (pathLoss === null || !Number.isFinite(bearingDeg) || bearingDeg<0 || bearingDeg>=360) return {error:'Enter probe distance 10–5000 m and bearing 0–359.999°.'};
  try{
    if(template.pattern==='sampled'){const grid=patternAssets?.get(template.sampled.patternId);if(!grid)throw Error('The imported scalar grid requires its qualified source model.');grid.checkCarrier(template.frequencyMHz,template.bandwidthMHz);if(Math.abs(template.gainDbi-grid.peakGainDbi(template.frequencyMHz))>1e-9)throw Error('Source-grid peak gain must equal its derived upper bound.');}
    const boundary=farFieldDistance(template,patternAssets);if(Math.hypot(distanceM,23.5)<boundary)return {error:`Probe is inside the ${template.pattern==='sampled'?'source grid':'array'} far-field boundary (${boundary.toFixed(1)} m slant distance). Increase distance or review antenna dimensions.`};
  }catch(error){return {error:error.message};}
  const elevation=Math.atan2(1.5-25,distanceM)*180/Math.PI;
  const attenuation=antennaAttenuation(template,bearingDeg-template.azimuthDeg,elevation,patternAssets);
  const eirpDbm=peakEirp(template);
  return {eirpDbm,pathLoss,attenuation,rxDbm:eirpDbm-attenuation-pathLoss};
}

export function siteLabel(site) {
  const p=site.properties;
  const id=(p.ised_site_ids || p.records.map(r=>r.record_id)).find(Boolean);
  return `${p.provider || 'TELUS'} ${id || p.site_id}`;
}

export function siteTopology(site, rat = 'all') {
  const grouped=new Map();
  for (const record of site.properties.records) {
    const technologies=record.technologies || [record.technology].filter(Boolean);
    if (rat !== 'all' && !technologies.some(t=>rat === 'NR' ? /5G|NR/i.test(t) : /LTE|4G/i.test(t))) continue;
    const azimuth=sectorAzimuth(record), pattern=antennaPattern(record);
    const key=azimuth === null ? pattern : `${azimuth}°`;
    if (!grouped.has(key)) grouped.set(key,{name:azimuth === null ? pattern === 'omni' ? 'Non-directional' : 'Bearing not reported' : `Bearing ${key}`,records:[],technologies:new Set()});
    const group=grouped.get(key); group.records.push(record); technologies.forEach(t=>group.technologies.add(t));
  }
  return [...grouped.values()].map(g=>({...g,technologies:[...g.technologies].sort(),count:g.records.reduce((n,r)=>n+(r.record_count ?? 1),0)}));
}
