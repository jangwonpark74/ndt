import {RADIO_TEMPLATES, ARRAY_DEFAULTS, PLANNING_REFERENCE, validateTemplate, predictProbe} from './planning-model.mjs';
import {createScenarioModel} from './scenario-model.mjs';
import {createScenarioViewModel} from './scenario-view-model.mjs';
import {CARRIER_PLAN,carrierBand,carrierFrequency,validateCarrier} from './carrier-plan.mjs';
import {equipmentStudyTemplate,equipmentStudyValues,equipmentStudyPath} from './equipment-study.mjs';
import {asCellStudy,updateCellPort,cellStudyPaths,addSourceCell} from './cell-study.mjs';
import {bindCellStudyView} from './cell-study-view.mjs';
import {bindPatternView} from './pattern-view.mjs';
import {sourceGrid,inspectGrid,refreshGridGain,templateGridAssets} from './pattern-study.mjs';
import {POLARIZATION_MODEL} from './polarization-model.mjs';
import {receiverStudyError} from './receiver-study.mjs';
import {bindReceiverView} from './receiver-view.mjs';

export function bindPlanningView({regionId,getProject,getSelectedSite=()=>null,getEquipmentInventory=()=>null,getSiteLabel=id=>id,getRunParticipation=()=>null}) {
  const $=id=>document.getElementById(id), form=$('radio-template-form');
  const fields=['frequencyMHz','bandwidthMHz','powerDbm','gainDbi','lossDb','tiltDeg','azimuthDeg','pattern','mode'];
  const arrayFields=Object.keys(ARRAY_DEFAULTS);
  let rat='LTE',carrierVersion=CARRIER_PLAN.version,equipmentSource=null,pendingLoad=Promise.resolve(),contextVersion=0,sampled=null,polarizationVersion=POLARIZATION_MODEL;
  const scenarios=createScenarioViewModel(createScenarioModel(regionId));
  let previousDraft,overrideSite='',modeDrafts={},targetSignature='';
  const isCells=()=>scenarios.getState().draft?.assignmentMode==='cells';
  const targetTemplate=d=>isCells() && overrideSite ? d.cells?.find(c=>c.cellId===overrideSite.split('/')[0])?.ports.find(p=>p.equipmentSource.linkId===overrideSite.split('/')[1]) : d?.overrides?.[overrideSite];
  const cellView=bindCellStudyView({regionId,getProject,getDraft:()=>scenarios.getState().draft,getCurrentInventory:getEquipmentInventory,isBusy:()=>{const s=scenarios.getState();return s.loading || s.saving;},onEdit:d=>scenarios.edit(d),onPort:target=>{overrideSite=target;fill(targetTemplate(scenarios.getState().draft));document.querySelector('.scenario-overrides').open=true;$('scenario-target').value=target;$('scenario-target').focus();},onSourceChange:()=>{if(isCells()){syncTargets();render();}}});
  $('cell-study-open').onclick=event=>cellView.open(event.currentTarget);
  const evidence=document.createElement('div');evidence.className='equipment-study';evidence.hidden=true;
  evidence.innerHTML='<p id="template-equipment-status" class="network-note" role="status"></p><details><summary>Compare reported inputs</summary><p class="network-note">Source records are user-supplied. Modeled power, feeder loss, environment and antenna model are study assumptions; vendor cuts are reviewed separately.</p><table><thead><tr><th scope="col">Input</th><th scope="col">Reported</th><th scope="col">Study</th></tr></thead><tbody id="template-equipment-values"></tbody></table><p id="template-equipment-hash" class="network-note"></p></details><div class="study-actions"><button id="template-equipment-clear" type="button">Keep as assumptions</button></div>';
  form.before(evidence);
  function draft(){const base=scenarios.getState().draft;const next={...base,name:$('scenario-name').value};if(isCells())return overrideSite?updateCellPort(next,...overrideSite.split('/'),read(),cellView.getInventory()):{...next,template:read()};return {...next,template:overrideSite ? base.template : read(),overrides:overrideSite ? {...base.overrides,[overrideSite]:read()} : base?.overrides || {}};}
  const key=()=>`ndt-radio-template:${regionId}:${getProject()?.id || 'region'}`;
  const sourceInventory=()=>isCells()?cellView.getInventory():getEquipmentInventory();
  const patternView=bindPatternView({getContext:()=>({project:getProject(),target:overrideSite,inventory:sourceInventory(),template:read(),allowUse:isCells() && !!overrideSite,busy:scenarios.getState().loading || scenarios.getState().saving || cellView.isSourceBusy(),stale:cellView.isStale()}),onUse:t=>{fill(t);edited();(Number.isFinite(t.tiltDeg)?form.elements.patternRoll:form.elements.tiltDeg).focus();}});
  $('pattern-source-review').onclick=event=>patternView.open(event.currentTarget);
  let receiverDraftSnapshot=null;
  const receiverView=bindReceiverView({getContext:()=>{const state=scenarios.getState();return {project:getProject(),draft:state.draft||receiverDraftSnapshot,busy:state.loading||state.saving||cellView.isSourceBusy()};},onApply:next=>{scenarios.edit(next);$('template-save-status').textContent='Receiver assumptions staged. Save and apply a revision to execute them.';}});
  $('receiver-study-open').onclick=event=>{receiverDraftSnapshot=scenarios.getState().draft||draft();receiverView.open(event.currentTarget);};
  function read() {
    const t={rat,...Object.fromEntries(fields.map(f=>[f,['pattern','mode'].includes(f)?form.elements[f].value:form.elements[f].value.trim()===''?NaN:Number(form.elements[f].value)])),...(form.elements.pattern.value==='array'?{array:Object.fromEntries(arrayFields.map(f=>[f,form.elements[f].value.trim()===''?NaN:Number(form.elements[f].value)]))}:{}),...($('carrier-enabled').checked?{carrier:{standard:carrierVersion,band:form.elements.carrierBand.value,channel:form.elements.channel.value===''?NaN:Number(form.elements.channel.value),scsKHz:Number(form.elements.carrierScs.value)}}:{}),...(equipmentSource?{equipmentSource}:{})};
    if(form.elements.txPolarizationEnabled.checked)t.polarization={model:polarizationVersion,slantDeg:form.elements.txSlant.valueAsNumber,...(t.pattern==='sampled'?{}:{rollDeg:form.elements.txRoll.valueAsNumber})};
    if(t.pattern==='sampled'){t.sampled={...sampled,rollDeg:form.elements.patternRoll.value===''?NaN:Number(form.elements.patternRoll.value)};return refreshGridGain(t,sourceInventory());}return t;
  }
  function renderEvidence(template){
    evidence.hidden=!equipmentSource;$('template-equipment-clear').hidden=isCells();if(!equipmentSource)return;
    const status=$('template-equipment-status'),rows=$('template-equipment-values');rows.replaceChildren();evidence.dataset.invalid='false';
    $('template-equipment-clear').disabled=scenarios.getState().loading || scenarios.getState().saving;
    $('template-equipment-hash').textContent=`Original source SHA-256 ${equipmentSource.sha256}`;
    try{
      const inventory=sourceInventory(),cell=inventory?.data.cells.find(c=>c.id===equipmentSource.cellId),sector=inventory?.data.sectors.find(s=>s.id===cell?.sectorId),sourceSite=inventory?.data.sites.find(s=>s.id===sector?.siteId),siteId=isCells()?sourceSite?.inventorySiteId:overrideSite,cellLabel=cell?.cellIdentity || equipmentSource.cellId,reported=equipmentStudyValues(inventory,equipmentSource,siteId,{allowHistorical:isCells()}),comparison={...template};
      if(template.pattern==='sampled'){const c=inspectGrid(inventory,equipmentSource);reported.gainDbi=c.grid.peakGainDbi(template.frequencyMHz);reported.tiltDeg=c.path.antenna.mechanicalTiltDeg ?? null;reported.rollDeg=c.path.antenna.mechanicalRollDeg ?? null;comparison.rollDeg=template.sampled.rollDeg;}
      const missing=Object.values(reported).filter(v=>v===null).length,changed=Object.entries(reported).filter(([key,v])=>v!==null && v!==comparison[key]).length;
      status.textContent=`${getProject()?.name || ''} / ${getSiteLabel(siteId)} · Source revision ${equipmentSource.revision} · ${cellLabel}${missing?` · ${missing} ${missing===1?'input':'inputs'} not reported`:''}${changed?` · ${changed} modeled ${changed===1?'edit':'edits'}`:''}${!isCells() && getRunParticipation(overrideSite)===false?' · Outside current Bell run membership':''}`;
      for(const [key,label]of Object.entries({rat:'RAT',frequencyMHz:'Carrier MHz',bandwidthMHz:'Bandwidth MHz',azimuthDeg:'Azimuth deg',gainDbi:template.pattern==='sampled'?'Grid peak bound dBi':'Peak gain dBi',tiltDeg:template.pattern==='sampled'?'Mechanical downtilt deg':'Downtilt deg',...(template.pattern==='sampled'?{rollDeg:'Mechanical roll deg'}:{})})){
        const row=document.createElement('tr');for(const [i,value]of [label,reported[key]??'Not reported',typeof comparison[key]==='number' && !Number.isFinite(comparison[key])?'Enter value':comparison[key]].entries()){const cell=document.createElement(i?'td':'th');if(!i)cell.scope='row';cell.textContent=value;row.append(cell);}rows.append(row);
      }
    }catch(error){evidence.dataset.invalid='true';status.textContent=`Source revision ${equipmentSource.revision} · ${error.message}`;}
  }
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
    equipmentSource=t.equipmentSource || null;sampled=t.sampled || null;form.elements.patternRoll.value=t.sampled?.rollDeg ?? '';
    polarizationVersion=t.polarization?.model||POLARIZATION_MODEL;form.elements.txPolarizationEnabled.checked=!!t.polarization;form.elements.txSlant.value=t.polarization?.slantDeg??'';form.elements.txRoll.value=t.polarization?.rollDeg??t.sampled?.rollDeg??'';
    rat=t.rat;$('template-preset').value=rat === 'NR' ? 'nr' : 'lte';fields.forEach(f=>form.elements[f].value=t[f]);
    arrayFields.forEach(f=>form.elements[f].value=(t.array || ARRAY_DEFAULTS)[f]);
    form.elements.carrierBand.replaceChildren(...CARRIER_PLAN.bands.filter(b=>b.rat===rat).map(b=>new Option(`${b.id} · ${b.duplex}`,b.id)));
    const c=t.carrier,b=carrierBand(c?.band || (rat==='NR'?'n78':'B4'));
    $('carrier-enabled').checked=!!c;carrierVersion=c?.standard || CARRIER_PLAN.version;
    form.elements.carrierBand.value=c?.band || b.id;form.elements.channel.value=c?.channel ?? b.defaultChannel;form.elements.carrierScs.value=c?.scsKHz ?? b.scsKHz;
    syncCarrier();render();
  }
  function syncTargets(state=scenarios.getState()){const cells=state.draft?.assignmentMode==='cells';
    if(overrideSite && !targetTemplate(state.draft))overrideSite='';
    let targets=[];if(cells){try{targets=cellStudyPaths(state.draft,cellView.getInventory()).flatMap(c=>c.ports.map(p=>new Option(`${c.cell.cellIdentity || c.cellId} · ${c.site.inventorySiteId} / ${p.radioPort.name || p.radioPort.id} → ${p.antennaPort.name || p.antennaPort.id}`,`${c.cellId}/${p.link.id}`)));}catch{targets=(state.draft.cells || []).flatMap(c=>c.ports.map(p=>new Option(`${c.cellId} / ${p.equipmentSource.linkId}`,`${c.cellId}/${p.equipmentSource.linkId}`)));}}else targets=Object.keys(state.draft?.overrides || {}).map(id=>new Option(getSiteLabel(id),id));
    const signature=JSON.stringify([state.projectId,cells,targets.map(t=>[t.value,t.text])]);if(signature!==targetSignature){targetSignature=signature;$('scenario-target').replaceChildren(new Option(cells?'New port defaults':'Default template',''),...targets);}
    $('scenario-target').value=overrideSite;
  }
  function render() {
    const state=scenarios.getState(),receiver=state.draft?.receiver;
    const t=read();let assets=null,assetError='';try{assets=templateGridAssets(t,sourceInventory());}catch(error){assetError=error.message;}
    const result=assetError?{error:assetError}:predictProbe(t,Number(form.elements.distanceM.value || NaN),Number(form.elements.probeBearing.value === ''?NaN:form.elements.probeBearing.value),assets,receiver);
    const carrierError=validateCarrier(t),b=carrierBand(t.carrier?.band);
    $('template-result').replaceChildren();
    const assignmentError=(isCells()?cellView.validationError():'')||(state.draft?receiverStudyError(state.draft):'');
    $('template-error').textContent=assignmentError || result.error || '';$('template-error').hidden=!(assignmentError || result.error) || (!assignmentError && !!carrierError);
    const sampledPattern=t.pattern==='sampled',busy=state.loading || state.saving || cellView.isSourceBusy();
    $('receiver-study-open').disabled=!getProject()||busy;$('tx-polarization-controls').hidden=!receiver&&!t.polarization;$('tx-roll-field').hidden=sampledPattern;
    for(const name of ['txPolarizationEnabled','txSlant','txRoll'])form.elements[name].disabled=busy||!receiver;
    $('receiver-study-state').textContent=receiver?`LOS reference receiver · ${receiver.collection==='dual-orthogonal'?'ideal dual-orthogonal collection':'one linear polarization'} · transmitter assumptions are separate from source evidence.`:getProject()?'Scalar ideal receiver collection. Open Receiver study to define explicit LOS assumptions.':'Scalar ideal receiver collection. Choose a project to define a versioned LOS receiver study.';
    receiverView.sync();
    for(const field of [...fields,...arrayFields,'patternRoll','carrierEnabled','carrierBand','channel'])form.elements[field].disabled=busy;
    $('template-preset').disabled=busy;$('scenario-target').disabled=busy;$('scenario-copy').disabled=!state.projectId || busy || !!validateTemplate(t) || !!assignmentError;
    $('sampled-controls').hidden=!sampledPattern;$('template-tilt-label').textContent=sampledPattern?'Mechanical downtilt (degrees)':'Downtilt (degrees)';form.elements.gainDbi.readOnly=sampledPattern;form.elements.gainDbi.min=sampledPattern?'-120':'0';form.elements.gainDbi.max=sampledPattern?'50':'40';if(sampledPattern)form.elements.gainDbi.value=Number.isFinite(t.gainDbi)?t.gainDbi.toFixed(2):'';
    $('pattern-source-controls').hidden=!equipmentSource;$('pattern-source-review').disabled=busy;
    let gridIssue='';try{const c=sourceGrid(sourceInventory(),equipmentSource);c.grid.checkCarrier(t.frequencyMHz,t.bandwidthMHz);}catch(error){gridIssue=error.message;}
    form.elements.pattern.querySelector('[value=sampled]').disabled=!isCells() || !overrideSite || !!gridIssue;
    $('pattern-source-status').textContent=sampledPattern?'Imported total-power grid in use · gain is derived; mechanical orientation remains a study assumption.':gridIssue || 'Full-sphere source grid available. Review coordinates, electrical state and power convention before selecting it.';
    patternView.sync();
    $('array-controls').hidden=t.pattern!=='array';
    $('template-gain-label').textContent=sampledPattern?'Grid peak gain upper bound (dBi)':t.pattern==='array'?'Element peak gain (dBi)':'Peak gain (dBi)';
    $('array-source-gain-note').hidden=!equipmentSource;
    renderEvidence(t);
    $('carrier-check-status').textContent=carrierError || (t.carrier ? `Channel checks passed · ${b.id} · ${b.duplex} · ${t.carrier.scsKHz} kHz SCS` : qualification(t));
    $('carrier-check-status').dataset.invalid=String(!!carrierError);
    $('scenario-override-add').disabled=!getProject() || !getSelectedSite() || state.loading || state.saving || !!validateTemplate(t);
    $('scenario-override-remove').disabled=!overrideSite || state.loading || state.saving;
    $('template-save').disabled=!!validateTemplate(t) || !!assignmentError || state.loading || state.saving || (state.projectId && !!state.error && !state.items.length); $('template-export').disabled=!!result.error;
    if (result.error) return;
    for (const [label,value] of [['Study RAT',rat],['Carrier check',t.carrier?'Supported channel checks passed':'Generic · not checked'],[['array','sampled'].includes(t.pattern)?'EIRP upper bound':'Peak EIRP',`${result.eirpDbm.toFixed(1)} dBm`],['Path loss',`${result.pathLoss.toFixed(1)} dB`],['Pattern attenuation',`${result.attenuation.toFixed(1)} dB`],...(result.receiver?[['Receiver mismatch',result.zeroCollectedPower?'Ideal polarization null':`${result.receiver.mismatchLossDb.toFixed(1)} dB`]]:[]),['Predicted received power',result.zeroCollectedPower?'Zero collected power (ideal null)':`${result.rxDbm.toFixed(1)} dBm`]]) {
      const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('template-result').append(dt,dd);
    }
  }
  function edited(){if(getProject())scenarios.edit(draft());render();$('template-save-status').textContent='Unsaved study edits.';}
  $('template-preset').onchange=()=>{const source=equipmentSource;fill({...RADIO_TEMPLATES[$('template-preset').value],...(isCells() && source?{equipmentSource:source}:{})});edited();};
  form.oninput=event=>{
    if(event.target.name==='txPolarizationEnabled'&&event.target.checked)polarizationVersion=POLARIZATION_MODEL;
    if(event.target.name==='pattern' && event.target.value==='sampled'){form.elements.pattern.value=(targetTemplate(scenarios.getState().draft) || scenarios.getState().draft?.template)?.pattern || 'element';patternView.open(event.target);return;}
    if(event.target.name==='pattern' && event.target.value==='array' && equipmentSource)form.elements.gainDbi.value='';
    if(['carrierEnabled','carrierBand','channel','carrierScs'].includes(event.target.name)){
      if(event.target.name==='carrierBand'){const b=carrierBand(event.target.value);form.elements.channel.value=b.defaultChannel;form.elements.carrierScs.value=b.scsKHz;carrierVersion=CARRIER_PLAN.version;}
      syncCarrier(true);edited();
    }else if(fields.includes(event.target.name) || arrayFields.includes(event.target.name) || ['patternRoll','txPolarizationEnabled','txSlant','txRoll'].includes(event.target.name))edited();else render();
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
    ++contextVersion;
    receiverDraftSnapshot=null;
    const project=getProject();
    overrideSite='';modeDrafts={};
    if(project){fill(RADIO_TEMPLATES[$('template-preset').value]);$('scenario-name').value='Radio study';}
    pendingLoad=scenarios.load(project?.id || null).then(()=>{
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
    const template=read(),distanceM=Number(form.elements.distanceM.value),bearingDeg=Number(form.elements.probeBearing.value),receiver=scenarios.getState().draft?.receiver,result=predictProbe(template,distanceM,bearingDeg,templateGridAssets(template,sourceInventory()),receiver);
    if(result.error)return;
    const state=scenarios.getState(),scenario=state.selected;
    const blob=new Blob([JSON.stringify({...(receiver?{receiver,receiverAssumptions:'TR 38.901 Model-2 local linear fields and reciprocal LOS reference collection; explicit study assumptions, no NLOS depolarization, coherent inter-port phases, MIMO or field calibration.'}:{}),version:receiver?7:isCells() && (scenarios.getState().draft?.cells || []).some(c=>c.ports.some(p=>p.pattern==='sampled'))?6:isCells()?5:4,...(template.pattern==='sampled'?{patternModel:sourceInventory()?.patternModels?.find(p=>p.patternId===template.sampled.patternId),patternAssumptions:'Source total realized gain at a real reference, other ports matched. Linear power interpolation; center-frequency response, occupied-band coverage enforced. Electrical state embedded; mechanical azimuth, downtilt and roll separate. Slant distance >= 2D^2/wavelength. No additional antenna/array gain or independently verified field accuracy.'}:{}),...(isCells()?{sourceEquipment:cellView.getInventory(),cellAssumptions:receiver?'Uncorrelated port powers sum after the explicitly assumed LOS receiver projection; no coherent inter-port phases or MIMO.':'Uncorrelated mean port powers sum within a cell; ideal polarization-insensitive power collection. All assigned LTE/NR ports share explicit modeled radio budgets. No coherent inter-port phases, MIMO or reference-signal allocation.'}:{}),arrayAssumptions:template.pattern==='array'?{nullFloorDb:120,farField:'Slant distance >= 2D^2/wavelength using array diagonal D',minimumRouteOutputDbm:-300,panelCount:1,polarizations:1,weights:'Uniform unit-norm coherent weights',geometry:template.array}:null,regionId,projectId:getProject()?.id || null,template,templateTarget:overrideSite || null,probe:{distanceM,bearingDeg},result,scenario:scenario ? {...scenario,unsavedEdits:state.dirty,...(isCells()||receiver?{draft:draft()}: {})} : isCells()||receiver?{draft:draft(),unsavedEdits:true}:null,reference:PLANNING_REFERENCE,carrierQualification:qualification(template),carrierReference:template.carrier ? CARRIER_PLAN.references[rat] : null,powerConvention:'Total average conducted power per modeled carrier/port; array beam power is shared across elements. EIRP upper bound = TX power + element peak gain + 10log10(rows*columns) - loss for arrays; without an array, peak EIRP = TX power + peak gain - loss. No reference-signal allocation.',model:'UMa mean path loss, 25 m BS / 1.5 m UE; reference element, isotropic, uniform single-panel scalar array or explicitly linked source total realized-gain grid; 120 dB numerical array-null cap. Bandwidth and RAT do not change the path-loss formula. The probe is independent of map fans and virtual drives. Saved applied templates can be selected for directional virtual drives.'},null,2)],{type:'application/json'});
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
    $('scenario-copy').disabled=!project || busy || !!validateTemplate(read()) || (isCells() && !!cellView.validationError());
    $('scenario-name').disabled=busy;
    $('template-preset').disabled=busy;
    $('scenario-target').disabled=busy;
    for(const field of [...fields,...arrayFields])form.elements[field].disabled=busy;
    for(const name of ['carrierEnabled','carrierBand','channel'])form.elements[name].disabled=busy;
    for(const id of ['scenario-baseline','scenario-apply'])$(id).disabled=!state.selected || busy || state.dirty;
    $('scenario-error').textContent=state.error;$('scenario-error').hidden=!state.error;
    $('scenario-state').textContent=!project ? 'Select a project for database saving.' : state.loading ? 'Loading saved scenarios...' : `${state.dirty ? 'Unsaved edits. ' : ''}Draft revision ${state.selected?.revision || 0} | Baseline ${state.selected?.baselineRevision || 'none'} | Applied ${state.selected?.appliedRevision || 'none'}`;
    $('scenario-history').replaceChildren();
    const cells=state.draft?.assignmentMode==='cells';
    syncTargets(state);
    $('scenario-assignment-mode').value=cells?'cells':'sites';$('scenario-assignment-mode').disabled=!project || busy;
    $('cell-study-controls').hidden=!cells;$('cell-study-open').disabled=busy;
    $('scenario-target-heading').textContent=cells?'Cell port templates':'Site overrides';
    $('scenario-override-note').textContent=cells?(overrideSite?'Radio settings propagate to every port of this cell. Antenna settings and conducted power apply to the selected path. The probe predicts one port.':'This probe also seeds conducted power, feeder loss and environment for new paths. Source copying replaces reported inputs and resets antenna/carrier models. These defaults do not execute.'):'Site overrides are planning assumptions, not verified equipment assignments.';
    for(const id of ['scenario-override-add','scenario-override-remove'])$(id).hidden=cells;
    for(const option of $('template-preset').options)option.disabled=cells && !!overrideSite && (option.value==='nr'?'NR':'LTE')!==targetTemplate(state.draft)?.rat;
    $('scenario-target').value=overrideSite;
    for(const version of state.selected?.versions || []){const li=document.createElement('li');li.textContent=`Revision ${version.revision}: ${version.name} (${new Date(version.createdAt).toLocaleString()})`;li.title=`Source ${version.sourceFingerprint}; model ${version.modelVersion}`;$('scenario-history').append(li);}
    if(state.draft && state.draft!==previousDraft){previousDraft=state.draft;$('scenario-name').value=state.draft.name;fill(targetTemplate(state.draft) || state.draft.template);}
    cellView.sync();render();
  });
  $('scenario-assignment-mode').onchange=()=>{const current=draft(),mode=$('scenario-assignment-mode').value;modeDrafts[isCells()?'cells':'sites']=structuredClone(current);overrideSite='';const next=modeDrafts[mode] || (mode==='cells'?asCellStudy(current):{name:current.name,template:structuredClone(current.template),overrides:{},...(current.receiver?{receiver:structuredClone(current.receiver)}:{})});scenarios.edit({...next,name:current.name});};
  $('scenario-picker').onchange=()=>{overrideSite='';modeDrafts={};scenarios.select($('scenario-picker').value);};
  $('scenario-new').onclick=()=>{overrideSite='';modeDrafts={};fill(RADIO_TEMPLATES[$('template-preset').value]);scenarios.newDraft({name:'New radio study',template:read(),overrides:{}});$('scenario-name').focus();};
  $('scenario-discard').onclick=()=>{overrideSite='';modeDrafts={};const id=scenarios.getState().selected?.id;scenarios.select(id);if(!id){fill(RADIO_TEMPLATES[$('template-preset').value]);$('scenario-name').value='Radio study';}};
  $('scenario-reload').onclick=()=>{++contextVersion;pendingLoad=scenarios.load(getProject()?.id || null).catch(()=>{});};
  $('scenario-copy').onclick=()=>{const copy={...draft(),name:`${$('scenario-name').value.slice(0,110)} copy`};scenarios.newDraft(copy);scenarios.save({...copy,id:crypto.randomUUID()}).catch(()=>{});};
  $('scenario-target').onchange=()=>{overrideSite=$('scenario-target').value;const d=scenarios.getState().draft;if(d)fill(targetTemplate(d) || d.template);};
  $('scenario-override-add').onclick=()=>{const site=getSelectedSite();if(!site)return;const d=draft();overrideSite=site.properties.site_id;scenarios.edit({...d,overrides:{...d.overrides,[overrideSite]:structuredClone(d.template)}});};
  $('scenario-override-remove').onclick=()=>{const d=draft(),overrides={...d.overrides};delete overrides[overrideSite];overrideSite='';scenarios.edit({...d,overrides});};
  document.addEventListener('networksitechange',render);
  document.addEventListener('equipmentinventorychange',()=>{cellView.sync();render();});
  $('template-equipment-clear').onclick=()=>{equipmentSource=null;edited();};
  document.addEventListener('equipmentstudyrequested',async event=>{
    const {projectId,siteId,reference}=event.detail,token=contextVersion;
    form.closest('details').open=true;await pendingLoad;
    if(token!==contextVersion || getProject()?.id!==projectId || getSelectedSite()?.properties.site_id!==siteId)return;
    try{
      const inventory=getEquipmentInventory();equipmentStudyValues(inventory,reference,siteId);
      const state=scenarios.getState(),base=state.draft || draft(),template=equipmentStudyTemplate(base.template,inventory,reference.cellId,reference.linkId,siteId);
      if(isCells()){const existing=base.cells.find(c=>c.cellId===reference.cellId)?.ports.find(p=>p.equipmentSource.linkId===reference.linkId);overrideSite=`${reference.cellId}/${reference.linkId}`;if(existing){fill(existing);$('scenario-target').value=overrideSite;}else scenarios.edit(addSourceCell(base,inventory,reference.cellId,[reference.linkId]));}else{overrideSite=siteId;scenarios.edit({...base,overrides:{...base.overrides,[siteId]:template}});}
      document.querySelector('.scenario-overrides').open=true;$('scenario-target').focus();evidence.scrollIntoView({block:'nearest'});
      $('template-save-status').textContent=isCells()?'Source-cell path selected. Review the modeled port inputs, shared radio budget and exact carrier.':'Source-linked site draft. Review reported inputs, assumptions and exact carrier channel before saving.';
    }catch(error){$('template-save-status').textContent=error.message;}
  });
  for(const [id,action]of [['scenario-baseline','baseline'],['scenario-apply','apply']])$(id).onclick=()=>scenarios.save(draft(),action).catch(()=>{});
  document.addEventListener('projectcontextchange',load);
  load();
}
