import {RADIO_TEMPLATES, PLANNING_REFERENCE, validateTemplate, predictProbe} from './planning-model.mjs';
import {createScenarioModel} from './scenario-model.mjs';
import {createScenarioViewModel} from './scenario-view-model.mjs';
import {CARRIER_PLAN,carrierBand,carrierFrequency,validateCarrier} from './carrier-plan.mjs';

export function bindPlanningView({regionId,getProject,getSelectedSite=()=>null}) {
  const $=id=>document.getElementById(id), form=$('radio-template-form');
  const fields=['frequencyMHz','bandwidthMHz','powerDbm','gainDbi','lossDb','tiltDeg','azimuthDeg','pattern','mode'];
  let rat='LTE',carrierVersion=CARRIER_PLAN.version;
  const scenarios=createScenarioViewModel(createScenarioModel(regionId));
  let previousDraft,overrideSite='';
  function draft(){const base=scenarios.getState().draft;return {name:$('scenario-name').value,template:overrideSite ? base.template : read(),overrides:overrideSite ? {...base.overrides,[overrideSite]:read()} : base?.overrides || {}};}
  const key=()=>`ndt-radio-template:${regionId}:${getProject()?.id || 'region'}`;
  function read() {return {rat,...Object.fromEntries(fields.map(f=>[f,['pattern','mode'].includes(f) ? form.elements[f].value : form.elements[f].value.trim() === '' ? NaN : Number(form.elements[f].value)])),...($('carrier-enabled').checked ? {carrier:{standard:carrierVersion,band:form.elements.carrierBand.value,channel:form.elements.channel.value==='' ? NaN : Number(form.elements.channel.value),scsKHz:Number(form.elements.carrierScs.value)}} : {})};}
  function syncCarrier(derive=false){
    const enabled=$('carrier-enabled').checked,b=carrierBand(form.elements.carrierBand.value);
    $('carrier-controls').hidden=!enabled;form.elements.frequencyMHz.readOnly=enabled;
    if(!b)return;
    form.elements.channel.min=b.channelLow;form.elements.channel.max=b.channelHigh;form.elements.channel.step=b.channelStep;
    if(derive && enabled){const c=Number(form.elements.channel.value);form.elements.frequencyMHz.value=form.elements.channel.value==='' || !Number.isFinite(c) ? '' : carrierFrequency(b.id,c);}
    $('carrier-reference').href=CARRIER_PLAN.references[rat];
  }
  function qualification(t){const b=carrierBand(t.carrier?.band);return b ? `${b.rat==='NR'?'TS 38.104':'TS 36.104'} v18.5.0 Release 18; ${b.id} / ${b.duplex}; ${t.carrier.scsKHz} kHz SCS; ${CARRIER_PLAN.version}. Supported subset only.` : 'Generic study: no band/channel checks.';}
  function fill(t) {
    rat=t.rat;$('template-preset').value=rat === 'NR' ? 'nr' : 'lte';fields.forEach(f=>form.elements[f].value=t[f]);
    form.elements.carrierBand.replaceChildren(...CARRIER_PLAN.bands.filter(b=>b.rat===rat).map(b=>new Option(`${b.id} · ${b.duplex}`,b.id)));
    const c=t.carrier,b=carrierBand(c?.band || (rat==='NR'?'n78':'B4'));
    $('carrier-enabled').checked=!!c;carrierVersion=c?.standard || CARRIER_PLAN.version;
    form.elements.carrierBand.value=c?.band || b.id;form.elements.channel.value=c?.channel ?? b.defaultChannel;form.elements.carrierScs.value=c?.scsKHz ?? b.scsKHz;
    syncCarrier();render();
  }
  function render() {
    const t=read(), result=predictProbe(t,Number(form.elements.distanceM.value || NaN),Number(form.elements.probeBearing.value === '' ? NaN : form.elements.probeBearing.value));
    const carrierError=validateCarrier(t),b=carrierBand(t.carrier?.band);
    $('template-result').replaceChildren();
    $('template-error').textContent=result.error || ''; $('template-error').hidden=!result.error || !!carrierError;
    const state=scenarios.getState();
    $('carrier-check-status').textContent=carrierError || (t.carrier ? `Channel checks passed · ${b.id} · ${b.duplex} · ${t.carrier.scsKHz} kHz SCS` : qualification(t));
    $('carrier-check-status').dataset.invalid=String(!!carrierError);
    $('scenario-override-add').disabled=!getProject() || !getSelectedSite() || state.loading || state.saving || !!validateTemplate(t);
    $('scenario-override-remove').disabled=!overrideSite || state.loading || state.saving;
    $('template-save').disabled=!!validateTemplate(t) || state.loading || state.saving || (state.projectId && !!state.error && !state.items.length); $('template-export').disabled=!!result.error;
    if (result.error) return;
    for (const [label,value] of [['Study RAT',rat],['Carrier check',t.carrier?'Supported channel checks passed':'Generic · not checked'],['Peak EIRP',`${result.eirpDbm.toFixed(1)} dBm`],['Path loss',`${result.pathLoss.toFixed(1)} dB`],['Pattern attenuation',`${result.attenuation.toFixed(1)} dB`],['Predicted received power',`${result.rxDbm.toFixed(1)} dBm`]]) {
      const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('template-result').append(dt,dd);
    }
  }
  function edited(){if(getProject())scenarios.edit(draft());render();$('template-save-status').textContent='Unsaved study edits.';}
  $('template-preset').onchange=()=>{fill(RADIO_TEMPLATES[$('template-preset').value]);edited();};
  form.oninput=event=>{
    if(['carrierEnabled','carrierBand','channel','carrierScs'].includes(event.target.name)){
      if(event.target.name==='carrierBand'){const b=carrierBand(event.target.value);form.elements.channel.value=b.defaultChannel;form.elements.carrierScs.value=b.scsKHz;carrierVersion=CARRIER_PLAN.version;}
      syncCarrier(true);edited();
    }else if(fields.includes(event.target.name))edited();else render();
  };
  $('scenario-name').oninput=edited;
  form.onsubmit=event=>event.preventDefault();
  $('template-save').onclick=async()=>{
    const t=read(); if(validateTemplate(t))return;
    if(getProject()){
      try {await scenarios.save({...draft(),id:crypto.randomUUID()});$('template-save-status').textContent='Scenario revision saved in the planning database.';}
      catch { /* The scenario state displays the error and retains the draft. */ }
      return;
    }
    try {localStorage.setItem(key(),JSON.stringify(t));$('template-save-status').textContent='Study saved in this browser for the current project or region.';}
    catch {$('template-save-status').textContent='Browser storage unavailable. Export the study to retain it.';}
  };
  function load() {
    const project=getProject();
    overrideSite='';
    if(project){fill(RADIO_TEMPLATES[$('template-preset').value]);$('scenario-name').value='Radio study';}
    scenarios.load(project?.id || null).then(()=>{
      const state=scenarios.getState();
      if(!project || state.projectId!==project.id || state.items.length || state.draft)return;
      try {const saved=JSON.parse(localStorage.getItem(key()));if(saved && !validateTemplate(saved)){scenarios.newDraft({name:'Recovered browser study',template:saved,overrides:{}});$('template-save-status').textContent='Browser study recovered. Save study to retain it in the database.';}}
      catch { /* Browser recovery is optional; the database library remains available. */ }
    }).catch(()=>{});
    if(project)return;
    fill(RADIO_TEMPLATES[$('template-preset').value]);
    try {const saved=JSON.parse(localStorage.getItem(key())); if(saved && !validateTemplate(saved)) {fill(saved);$('template-save-status').textContent='Saved study loaded for this project or region.';} else $('template-save-status').textContent='Preset study. Save to keep edits in this browser.';}
    catch {$('template-save-status').textContent='Saved study unavailable. Preset loaded.';}
  }
  $('template-export').onclick=()=>{
    const template=read(),distanceM=Number(form.elements.distanceM.value),bearingDeg=Number(form.elements.probeBearing.value),result=predictProbe(template,distanceM,bearingDeg);
    if(result.error)return;
    const state=scenarios.getState(),scenario=state.selected;
    const blob=new Blob([JSON.stringify({version:3,regionId,projectId:getProject()?.id || null,template,templateTarget:overrideSite || null,probe:{distanceM,bearingDeg},result,scenario:scenario ? {...scenario,unsavedEdits:state.dirty} : null,reference:PLANNING_REFERENCE,carrierQualification:qualification(template),carrierReference:template.carrier ? CARRIER_PLAN.references[rat] : null,powerConvention:'Total average conducted power per modeled carrier/port; peak EIRP = TX power + peak gain - feeder loss. No reference-signal allocation.',model:'UMa mean path loss, 25 m BS / 1.5 m UE; single-element study, no array factor. Bandwidth and RAT do not change the path-loss formula. Independent of map fans and virtual drives.'},null,2)],{type:'application/json'});
    const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='radio-planning-study.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  };
  scenarios.subscribe(state=>{
    const project=!!state.projectId,busy=state.loading || state.saving;
    $('scenario-picker').replaceChildren(new Option('New scenario',''),...state.items.map(s=>new Option(s.name,s.id)));
    $('scenario-picker').value=state.selected?.id || '';
    $('scenario-picker').disabled=!project || busy || state.dirty;
    $('scenario-new').disabled=!project || busy || state.dirty;
    $('scenario-reload').disabled=!project || busy;
    $('scenario-discard').disabled=!project || busy || !state.dirty;
    $('scenario-copy').disabled=!project || busy || !!validateTemplate(read());
    $('scenario-name').disabled=busy;
    $('template-preset').disabled=busy;
    $('scenario-target').disabled=busy;
    for(const field of fields)form.elements[field].disabled=busy;
    for(const name of ['carrierEnabled','carrierBand','channel'])form.elements[name].disabled=busy;
    for(const id of ['scenario-baseline','scenario-apply'])$(id).disabled=!state.selected || busy || state.dirty;
    $('scenario-error').textContent=state.error;$('scenario-error').hidden=!state.error;
    $('scenario-state').textContent=!project ? 'Select a project for database saving.' : state.loading ? 'Loading saved scenarios...' : `${state.dirty ? 'Unsaved edits. ' : ''}Draft revision ${state.selected?.revision || 0} | Baseline ${state.selected?.baselineRevision || 'none'} | Applied ${state.selected?.appliedRevision || 'none'}`;
    $('scenario-history').replaceChildren();
    if(overrideSite && !state.draft?.overrides[overrideSite])overrideSite='';
    $('scenario-target').replaceChildren(new Option('Default template',''),...Object.keys(state.draft?.overrides || {}).map(id=>new Option(id,id)));
    $('scenario-target').value=overrideSite;
    for(const version of state.selected?.versions || []){const li=document.createElement('li');li.textContent=`Revision ${version.revision}: ${version.name} (${new Date(version.createdAt).toLocaleString()})`;li.title=`Source ${version.sourceFingerprint}; model ${version.modelVersion}`;$('scenario-history').append(li);}
    if(state.draft && state.draft!==previousDraft){previousDraft=state.draft;$('scenario-name').value=state.draft.name;fill(state.draft.overrides[overrideSite] || state.draft.template);}
    render();
  });
  $('scenario-picker').onchange=()=>{overrideSite='';scenarios.select($('scenario-picker').value);};
  $('scenario-new').onclick=()=>{overrideSite='';fill(RADIO_TEMPLATES[$('template-preset').value]);scenarios.newDraft({name:'New radio study',template:read(),overrides:{}});$('scenario-name').focus();};
  $('scenario-discard').onclick=()=>{const id=scenarios.getState().selected?.id;scenarios.select(id);if(!id){fill(RADIO_TEMPLATES[$('template-preset').value]);$('scenario-name').value='Radio study';}};
  $('scenario-reload').onclick=()=>scenarios.load(getProject()?.id || null).catch(()=>{});
  $('scenario-copy').onclick=()=>{const copy={...draft(),name:`${$('scenario-name').value.slice(0,110)} copy`};scenarios.newDraft(copy);scenarios.save({...copy,id:crypto.randomUUID()}).catch(()=>{});};
  $('scenario-target').onchange=()=>{overrideSite=$('scenario-target').value;const d=scenarios.getState().draft;if(d)fill(d.overrides[overrideSite] || d.template);};
  $('scenario-override-add').onclick=()=>{const site=getSelectedSite();if(!site)return;const d=draft();overrideSite=site.properties.site_id;scenarios.edit({...d,overrides:{...d.overrides,[overrideSite]:structuredClone(d.template)}});};
  $('scenario-override-remove').onclick=()=>{const d=draft(),overrides={...d.overrides};delete overrides[overrideSite];overrideSite='';scenarios.edit({...d,overrides});};
  document.addEventListener('networksitechange',render);
  for(const [id,action]of [['scenario-baseline','baseline'],['scenario-apply','apply']])$(id).onclick=()=>scenarios.save(draft(),action).catch(()=>{});
  document.addEventListener('projectcontextchange',load);
  load();
}
