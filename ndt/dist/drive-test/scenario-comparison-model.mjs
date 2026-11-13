const names={portAssignment:'Source port assignment',radioBudgetDbm:'Shared radio budget (dBm)',array:'Array geometry / steering',frequencyMHz:'Carrier (MHz)',mode:'Environment',pattern:'Antenna pattern',azimuthDeg:'Azimuth (deg)',tiltDeg:'Downtilt (deg)',powerDbm:'Conducted carrier/port power (dBm)',gainDbi:'Peak gain (dBi)',lossDb:'Feeder loss (dB)',bandwidthMHz:'Bandwidth (MHz)',carrier:'Carrier qualification',assignment:'RAT assignment',equipmentSource:'Equipment source'};
function value(parameter,input){
 if(input===null || input===undefined)return 'Not assigned';
 if(parameter==='carrier')return `${input.band} / channel ${input.channel} / ${input.scsKHz} kHz SCS`;
 if(parameter==='equipmentSource')return `Revision ${input.revision} / ${input.cellId} / ${input.linkId}`;
 if(parameter==='pattern')return input==='element'?'Reference element':input==='array'?'Uniform panel array':'Isotropic';
 if(parameter==='array')return `${input.rows} × ${input.columns} / ${input.verticalSpacing}λ V, ${input.horizontalSpacing}λ H / steer ${input.steerAzimuthDeg}° az, ${input.steerDowntiltDeg}° down`;
 return String(input);
}
export function scenarioChangeRows(changes){return changes.map(c=>[c.label || c.siteId,`${names[c.parameter] || c.parameter}${c.affectsPrediction?'':' · Recorded only'}`,value(c.parameter,c.baseline),value(c.parameter,c.applied)]);}

export function antennaDescription(t){return t.pattern==='array'?`Uniform panel array / ${value('array',t.array)}`:value('pattern',t.pattern);}
