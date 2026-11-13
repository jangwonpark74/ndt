const names={receiver:'LOS receiver collection',polarization:'Assumed TX polarization / roll',sampled:'Imported scalar grid / mechanical roll',portAssignment:'Source port assignment',radioBudgetDbm:'Shared radio budget (dBm)',array:'Array geometry / steering',frequencyMHz:'Carrier (MHz)',mode:'Environment',pattern:'Antenna pattern',azimuthDeg:'Azimuth (deg)',tiltDeg:'Downtilt (deg)',powerDbm:'Conducted carrier/port power (dBm)',gainDbi:'Peak gain (dBi)',lossDb:'Feeder loss (dB)',bandwidthMHz:'Bandwidth (MHz)',carrier:'Carrier qualification',assignment:'RAT assignment',equipmentSource:'Equipment source'};
export function receiverDescription(receiver){
 if(!receiver)return 'Scalar ideal polarization-insensitive collection';
 if(receiver.model!=='ndt.receiver.los-model2.v1')return `Unavailable receiver model: ${receiver.model}`;
 if(receiver.collection==='dual-orthogonal')return 'Model-2 ideal dual-orthogonal collection (no extra gain)';
 const o=receiver.orientation;return `Model-2 single linear / ${o.azimuthDeg}° bearing, ${o.tiltDeg}° down, ${o.rollDeg}° roll, ${o.slantDeg}° slant`;
}
function value(parameter,input){
 if(parameter==='receiver')return receiverDescription(input);
 if(input===null || input===undefined)return 'Not assigned';
 if(parameter==='polarization')return `Model-2 / ${input.slantDeg}° slant${Object.hasOwn(input,'rollDeg')?` / ${input.rollDeg}° mechanical roll`:''}`;
 if(parameter==='sampled')return `${input.patternId} / ${input.format} / ${input.rollDeg}° mechanical roll`;
 if(parameter==='carrier')return `${input.band} / channel ${input.channel} / ${input.scsKHz} kHz SCS`;
 if(parameter==='equipmentSource')return `Revision ${input.revision} / ${input.cellId} / ${input.linkId}`;
 if(parameter==='pattern')return input==='sampled'?'Imported scalar grid':input==='element'?'Reference element':input==='array'?'Uniform panel array':'Isotropic';
 if(parameter==='array')return `${input.rows} × ${input.columns} / ${input.verticalSpacing}λ V, ${input.horizontalSpacing}λ H / steer ${input.steerAzimuthDeg}° az, ${input.steerDowntiltDeg}° down`;
 return String(input);
}
export function scenarioChangeRows(changes){return changes.map(c=>[c.label || c.siteId,`${names[c.parameter] || c.parameter}${c.affectsPrediction?'':' · Recorded only'}`,value(c.parameter,c.baseline),value(c.parameter,c.applied)]);}

export function antennaDescription(t){const antenna=t.pattern==='sampled'?`Imported scalar grid / ${t.sampled.patternId} / ${t.sampled.rollDeg}° mechanical roll`:t.pattern==='array'?`Uniform panel array / ${value('array',t.array)}`:value('pattern',t.pattern);return antenna+(t.polarization?' / '+value('polarization',t.polarization):'');}
