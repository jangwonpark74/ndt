import {RADIO_TEMPLATES, PLANNING_REFERENCE, validateTemplate, predictProbe} from './planning-model.mjs';

export function bindPlanningView({regionId,getProject}) {
  const $=id=>document.getElementById(id), form=$('radio-template-form');
  const fields=['frequencyMHz','bandwidthMHz','powerDbm','gainDbi','lossDb','tiltDeg','azimuthDeg','pattern','mode'];
  let rat='LTE';
  const key=()=>`ndt-radio-template:${regionId}:${getProject()?.id || 'region'}`;
  function read() {return {rat,...Object.fromEntries(fields.map(f=>[f,['pattern','mode'].includes(f) ? form.elements[f].value : form.elements[f].value.trim() === '' ? NaN : Number(form.elements[f].value)]))};}
  function fill(t) {rat=t.rat; $('template-preset').value=rat === 'NR' ? 'nr' : 'lte'; fields.forEach(f=>form.elements[f].value=t[f]); render();}
  function render() {
    const t=read(), result=predictProbe(t,Number(form.elements.distanceM.value || NaN),Number(form.elements.probeBearing.value === '' ? NaN : form.elements.probeBearing.value));
    $('template-result').replaceChildren();
    $('template-error').textContent=result.error || ''; $('template-error').hidden=!result.error;
    $('template-save').disabled=!!validateTemplate(t); $('template-export').disabled=!!result.error;
    if (result.error) return;
    for (const [label,value] of [['Study RAT',rat],['Peak EIRP',`${result.eirpDbm.toFixed(1)} dBm`],['Path loss',`${result.pathLoss.toFixed(1)} dB`],['Pattern attenuation',`${result.attenuation.toFixed(1)} dB`],['Predicted received power',`${result.rxDbm.toFixed(1)} dBm`]]) {
      const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('template-result').append(dt,dd);
    }
  }
  $('template-preset').onchange=()=>{fill(RADIO_TEMPLATES[$('template-preset').value]);$('template-save-status').textContent='Preset loaded. Save to keep edits in this browser.';};
  form.oninput=()=>{render();$('template-save-status').textContent='Unsaved study edits.';};
  form.onsubmit=event=>event.preventDefault();
  $('template-save').onclick=()=>{
    const t=read(); if(validateTemplate(t))return;
    try {localStorage.setItem(key(),JSON.stringify(t));$('template-save-status').textContent='Study saved in this browser for the current project or region.';}
    catch {$('template-save-status').textContent='Browser storage unavailable. Export the study to retain it.';}
  };
  function load() {
    fill(RADIO_TEMPLATES[$('template-preset').value]);
    try {const saved=JSON.parse(localStorage.getItem(key())); if(saved && !validateTemplate(saved)) {fill(saved);$('template-save-status').textContent='Saved study loaded for this project or region.';} else $('template-save-status').textContent='Preset study. Save to keep edits in this browser.';}
    catch {$('template-save-status').textContent='Saved study unavailable. Preset loaded.';}
  }
  $('template-export').onclick=()=>{
    const template=read(),distanceM=Number(form.elements.distanceM.value),bearingDeg=Number(form.elements.probeBearing.value),result=predictProbe(template,distanceM,bearingDeg);
    if(result.error)return;
    const blob=new Blob([JSON.stringify({version:1,regionId,projectId:getProject()?.id || null,template,probe:{distanceM,bearingDeg},result,reference:PLANNING_REFERENCE,model:'UMa mean path loss, 25 m BS / 1.5 m UE; single-element study, no array factor. Bandwidth and RAT are metadata. Independent of map fans and virtual drives.'},null,2)],{type:'application/json'});
    const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='radio-planning-study.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  };
  document.addEventListener('projectcontextchange',load);
  load();
}
