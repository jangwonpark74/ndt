import {umaPathLoss} from './radio-model.mjs';
import {antennaPattern, sectorAzimuth} from './network-symbols.mjs';

export const PLANNING_REFERENCE = 'https://www.etsi.org/deliver/etsi_tr/138900_138999/138901/18.00.00_60/tr_138901v180000p.pdf';
// Radio presets are editable study assumptions; 3GPP defines the element pattern, not these deployments.
export const RADIO_TEMPLATES = Object.freeze({
  lte: {name:'4G LTE macro study',rat:'LTE',frequencyMHz:2100,bandwidthMHz:20,powerDbm:40,gainDbi:8,lossDb:2,tiltDeg:6,azimuthDeg:0,pattern:'element',mode:'NLOS'},
  nr: {name:'5G NR macro study',rat:'NR',frequencyMHz:3500,bandwidthMHz:100,powerDbm:40,gainDbi:8,lossDb:2,tiltDeg:6,azimuthDeg:0,pattern:'element',mode:'NLOS'},
});

export function validateTemplate(t) {
  const bounds = {frequencyMHz:[500,100000],bandwidthMHz:[.1,400],powerDbm:[-30,80],gainDbi:[0,40],lossDb:[0,40],tiltDeg:[-20,90],azimuthDeg:[0,359.999]};
  const labels={frequencyMHz:'carrier frequency (MHz)',bandwidthMHz:'bandwidth (MHz)',powerDbm:'TX power (dBm)',gainDbi:'peak gain (dBi)',lossDb:'feeder loss (dB)',tiltDeg:'downtilt (degrees)',azimuthDeg:'azimuth (degrees north)'};
  for (const [key,[low,high]] of Object.entries(bounds)) if (!Number.isFinite(t[key]) || t[key]<low || t[key]>high) return `Enter ${labels[key]} between ${low} and ${high}.`;
  if (!['LTE','NR'].includes(t.rat) || !['element','isotropic'].includes(t.pattern) || !['LOS','NLOS'].includes(t.mode)) return 'Select a supported RAT, antenna pattern and environment.';
  if (t.bandwidthMHz >= t.frequencyMHz) return 'Bandwidth must be smaller than carrier frequency.';
  if (t.pattern === 'isotropic' && t.gainDbi !== 0) return 'An isotropic antenna requires 0 dBi gain.';
  return '';
}

// TR 38.901 v18.0.0 table 7.3-1. Rotate the direction into the downtilted element frame.
export function elementAttenuation(azimuthOffsetDeg, elevationDeg, tiltDeg = 0) {
  const rad = Math.PI/180, a=azimuthOffsetDeg*rad, e=elevationDeg*rad, t=tiltDeg*rad;
  const x=Math.cos(e)*Math.cos(a), y=Math.cos(e)*Math.sin(a), z=Math.sin(e);
  const localX=Math.cos(t)*x-Math.sin(t)*z, localZ=Math.sin(t)*x+Math.cos(t)*z;
  const phi=Math.atan2(y,localX)/rad, theta=Math.acos(Math.max(-1,Math.min(1,localZ)))/rad;
  return Math.min(30,Math.min(30,12*(phi/65)**2)+Math.min(30,12*((theta-90)/65)**2));
}

export function predictProbe(template, distanceM, bearingDeg) {
  const error=validateTemplate(template);
  if (error) return {error};
  const pathLoss=umaPathLoss(distanceM,template.frequencyMHz,template.mode);
  if (pathLoss === null || !Number.isFinite(bearingDeg) || bearingDeg<0 || bearingDeg>=360) return {error:'Enter probe distance 10–5000 m and bearing 0–359.999°.'};
  const elevation=Math.atan2(1.5-25,distanceM)*180/Math.PI;
  const attenuation=template.pattern === 'element' ? elementAttenuation(bearingDeg-template.azimuthDeg,elevation,template.tiltDeg) : 0;
  const eirpDbm=template.powerDbm+template.gainDbi-template.lossDb;
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
