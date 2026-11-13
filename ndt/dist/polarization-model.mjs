// TR 38.901 7.3.2 Model-2 in right-handed East/North/Up world coordinates.
export const RECEIVER_MODEL='ndt.receiver.los-model2.v1';
export const POLARIZATION_MODEL='3gpp-38.901-model2';
export const NULL_POWER_FRACTION=1e-28;
const rad=Math.PI/180,bounds={azimuthDeg:[0,359.999],tiltDeg:[-90,90],rollDeg:[-180,180],slantDeg:[-90,90]},prepared=new WeakSet();
const number=(v,lo,hi,label)=>{if(!Number.isFinite(v)||v<lo||v>hi)throw Error(`${label}: enter a finite number from ${lo} to ${hi}.`);return v;};
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
function direction(azimuth,elevation){const a=number(azimuth,0,360,'Link bearing')*rad,e=number(elevation,-90,90,'Link elevation')*rad;return [Math.cos(e)*Math.sin(a),Math.cos(e)*Math.cos(a),Math.sin(e)];}

export function preparePolarization(orientation){
 if(!orientation||typeof orientation!=='object'||Array.isArray(orientation)||Object.keys(orientation).sort().join(',')!==Object.keys(bounds).sort().join(','))throw Error('Provide antenna bearing, downtilt, mechanical roll and Model-2 slant.');
 for(const [key,[lo,hi]]of Object.entries(bounds))number(orientation[key],lo,hi,key);
 const [a,t,r,slant]=Object.keys(bounds).map(k=>orientation[k]*rad),right=[Math.cos(a),-Math.sin(a),0],baseUp=[Math.sin(a)*Math.sin(t),Math.cos(a)*Math.sin(t),Math.cos(t)],up=right.map((v,i)=>v*Math.sin(r)+baseUp[i]*Math.cos(r)),left=right.map((v,i)=>-v*Math.cos(r)+baseUp[i]*Math.sin(r)),cs=Math.cos(slant),ss=Math.sin(slant);
 function vector(d,orthogonal=false){
  let phi=cross(up,d);
  // At the spherical pole, use phi=0 and project the body's left axis transverse.
  if(Math.hypot(...phi)<1e-12){const along=dot(left,d);phi=left.map((v,i)=>v-along*d[i]);}
  phi=unit(phi);const theta=cross(phi,d),c=orthogonal?-ss:cs,s=orthogonal?cs:ss;
  return theta.map((v,i)=>c*v+s*phi[i]);
 }
 const result={vector,field:(azimuth,elevation)=>vector(direction(azimuth,elevation))};prepared.add(result);return Object.freeze(result);
}

export function prepareReceiver(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='collection,model,orientation')throw Error('Provide a complete versioned LOS reference receiver.');
 if(value.model!==RECEIVER_MODEL||!['single-linear','dual-orthogonal'].includes(value.collection))throw Error('Select single-linear or ideal dual-orthogonal LOS Model-2 collection.');
 const receiver=preparePolarization(value.orientation),dual=value.collection==='dual-orthogonal';
 return {coupling(transmitter,azimuth,elevation){
  if(!prepared.has(transmitter))throw Error('Prepare the transmitter polarization before receiver evaluation.');
  const d=direction(azimuth,elevation),tx=transmitter.vector(d),incoming=d.map(v=>-v),rx=[receiver.vector(incoming)];if(dual)rx.push(receiver.vector(incoming,true));
  let q=rx.reduce((n,v)=>n+dot(tx,v)**2,0);if(!Number.isFinite(q)||q>1+1e-12)throw Error('Receiver projection violates passive power collection.');
  q=q<NULL_POWER_FRACTION?0:q>1-1e-12?1:q;return {powerFraction:q,mismatchLossDb:q?-10*Math.log10(q):null,txField:tx,rxFields:rx};
 }};
}

export function templateOrientation(template){
 const p=template.polarization,grid=template.pattern==='sampled',keys=grid?'model,slantDeg':'model,rollDeg,slantDeg';
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!==keys||p.model!==POLARIZATION_MODEL)throw Error('Provide explicit Model-2 transmitter polarization; grids use their existing mechanical roll.');
 if(template.mode!=='LOS')throw Error('The reference receiver requires LOS; NLOS depolarization is not implemented.');
 return {azimuthDeg:template.azimuthDeg,tiltDeg:template.tiltDeg,rollDeg:grid?template.sampled?.rollDeg:p.rollDeg,slantDeg:p.slantDeg};
}
export function validateTemplatePolarization(template){if(Object.hasOwn(template,'polarization'))preparePolarization(templateOrientation(template));}
export function validateReceiverTemplates(receiver,templates){
 if(receiver==null){if(templates.some(t=>Object.hasOwn(t,'polarization')))throw Error('Explicit transmitter polarization requires its LOS receiver study.');return null;}
 const prepared=prepareReceiver(receiver);for(const t of templates)preparePolarization(templateOrientation(t));return prepared;
}
