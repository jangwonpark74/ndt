import plan from './carrier-bands.json' with {type:'json'};
export const CARRIER_PLAN=plan;
export const carrierBand=id=>plan.bands.find(b=>b.id===id);
export function carrierFrequency(band,channel){const b=carrierBand(band);return Math.round((b.frequencyBaseMHz+(channel-b.channelOffset)*b.rasterMHz)*1e6)/1e6;}
export function validateCarrier(template,required=false){
  const c=template.carrier;
  if(c===undefined)return required?'Choose a supported band and channel before a qualified study.':'';
  if(!c || typeof c!=='object' || Array.isArray(c) || Object.keys(c).sort().join(',')!=='band,channel,scsKHz,standard' || c.standard!==plan.version)return 'Unsupported carrier plan version or fields.';
  const b=carrierBand(c.band);
  if(!b)return 'Choose a supported band for this implementation.';
  if(b.rat!==template.rat)return 'Selected band does not match the study RAT.';
  if(c.scsKHz!==b.scsKHz)return `Supported SCS for ${b.id} in this implementation is ${b.scsKHz} kHz.`;
  if(!Number.isSafeInteger(c.channel))return 'Enter an integer EARFCN or NR-ARFCN.';
  if(c.channel<b.channelLow || c.channel>b.channelHigh || (c.channel-b.channelLow)%b.channelStep!==0)return `Follow the ${b.id} channel raster: ${b.channelLow} to ${b.channelHigh}, step ${b.channelStep}.`;
  const f=carrierFrequency(b.id,c.channel);
  if(!Number.isFinite(template.frequencyMHz) || Math.abs(f-template.frequencyMHz)>1e-6)return `Carrier must match channel frequency ${f} MHz.`;
  if(!b.bandwidthsMHz.includes(template.bandwidthMHz))return `Supported ${b.id} bandwidth values (MHz): ${b.bandwidthsMHz.join(', ')}.`;
  if(f-template.bandwidthMHz/2<b.lowMHz-1e-6 || f+template.bandwidthMHz/2>b.highMHz+1e-6)return 'Channel bandwidth crosses the operating band edge. Choose a channel farther inside the band.';
  return '';
}
