import {POLARIZATION_MODEL,preparePolarization,validateReceiverTemplates} from './polarization-model.mjs';

export function receiverTemplates(draft){return [draft.template,...Object.values(draft.overrides||{}),...(draft.cells||[]).flatMap(c=>c.ports)];}
export function receiverStudyError(draft){
 try{if(Object.hasOwn(draft,'receiver')&&draft.receiver==null)throw Error('Provide an explicit receiver or return to scalar collection.');validateReceiverTemplates(draft.receiver,receiverTemplates(draft));return '';}
 catch(error){return error.message;}
}
export function applyReceiverStudy(draft,receiver,{slantDeg,rollDeg}){
 preparePolarization({azimuthDeg:0,tiltDeg:0,slantDeg,rollDeg});
 const result=structuredClone(draft);result.receiver=structuredClone(receiver);
 for(const t of receiverTemplates(result)){t.mode='LOS';t.polarization={model:POLARIZATION_MODEL,slantDeg,...(t.pattern==='sampled'?{}:{rollDeg})};}
 const error=receiverStudyError(result);if(error)throw Error(error);return result;
}
export function removeReceiverStudy(draft){const result=structuredClone(draft);delete result.receiver;for(const t of receiverTemplates(result))delete t.polarization;return result;}
