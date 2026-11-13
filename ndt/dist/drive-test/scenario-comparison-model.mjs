const names={frequencyMHz:'Carrier (MHz)',mode:'Environment',pattern:'Antenna pattern',azimuthDeg:'Azimuth (deg)',tiltDeg:'Downtilt (deg)',powerDbm:'Conducted carrier/port power (dBm)',gainDbi:'Peak gain (dBi)',lossDb:'Feeder loss (dB)',bandwidthMHz:'Bandwidth (MHz)',carrier:'Carrier qualification',assignment:'RAT assignment'};
function value(parameter,input){
 if(input===null || input===undefined)return 'Not assigned';
 if(parameter==='carrier')return `${input.band} / channel ${input.channel} / ${input.scsKHz} kHz SCS`;
 if(parameter==='pattern')return input==='element'?'Reference element':'Isotropic';
 return String(input);
}
export function scenarioChangeRows(changes){return changes.map(c=>[c.label || c.siteId,`${names[c.parameter] || c.parameter}${c.affectsPrediction?'':' · Recorded only'}`,value(c.parameter,c.baseline),value(c.parameter,c.applied)]);}
