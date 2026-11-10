import {showProjectOverview} from './context-panel.mjs';

export function createVirtualUeView({map, regionId}) {
  const $ = id => document.getElementById(id), projects = new Map();
  let project = null, active = false;
  const current = () => project && projects.get(project.id);
  const base = id => `/api/regions/${encodeURIComponent(regionId)}/projects/${encodeURIComponent(id)}/virtual-ues`;
  const valid = item => item && typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(item.id) && typeof item.name === 'string' && item.name.trim() && item.name.length <= 120 && Number.isFinite(item.longitude) && Math.abs(item.longitude) <= 180 && Number.isFinite(item.latitude) && Math.abs(item.latitude) <= 90;
  function features() {
    const state = current(), list = active && state?.loaded ? state.records : [];
    const points = list.filter(item => item.id !== state.editing).map(item => ({...item, draft:false}));
    if (active && state?.draft) {
      const {name, longitude, latitude} = state.draft, lon = Number(longitude), lat = Number(latitude);
      if (longitude !== '' && latitude !== '' && Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90)
        points.push({name, longitude:lon, latitude:lat, draft:true});
    }
    return {type:'FeatureCollection',features:points.map(item=>({type:'Feature',properties:{name:item.name,draft:item.draft},geometry:{type:'Point',coordinates:[item.longitude,item.latitude]}}))};
  }
  function draw() {
    map.getSource('virtual-ues')?.setData(features());
    map.getCanvas().classList.toggle('ue-placing',Boolean(active && current()?.placing));
  }
  function render() {
    const s = current();
    $('ue-project-title').textContent = project?.name || '';
    $('ue-status').textContent = !s ? 'Select a project first.' : s.loading ? 'Loading virtual UEs…' : !s.loaded ? 'Virtual UEs could not be loaded.' : `${s.records.length} saved ${s.records.length === 1 ? 'virtual UE' : 'virtual UEs'}${s.dirty ? ' · Unsaved draft' : ''}`;
    $('ue-retry').hidden = !s || s.loaded || s.loading;
    $('ue-new').disabled = !s?.loaded || s.saving || s.dirty;
    $('ue-list').replaceChildren();
    for (const item of s?.records || []) {
      const button = document.createElement('button'); button.type='button'; button.className='task-list-item'; button.textContent=item.name;
      button.setAttribute('aria-pressed',String(item.id === s.editing)); button.disabled=s.saving || s.dirty;
      button.onclick = () => {s.editing=item.id;s.draft={name:item.name,longitude:String(item.longitude),latitude:String(item.latitude)};s.dirty=false;s.error='';s.placing=false;render();$('ue-name').focus();};
      $('ue-list').append(button);
    }
    $('ue-form').hidden = !s?.draft;
    if (s?.draft) {
      for (const field of ['name','latitude','longitude']) { $("ue-"+field).value=s.draft[field]; $("ue-"+field).disabled=s.saving; }
      $('ue-save-state').textContent = s.saving ? 'Saving…' : s.dirty ? 'Unsaved' : 'Saved';
      $('ue-save').disabled = s.saving || !s.dirty || s.placing;
      $('ue-discard').disabled = s.saving;
      $('ue-delete').hidden = !s.editing; $('ue-delete').disabled = s.saving || s.placing;
      $('ue-place').disabled = s.saving || s.placing;
      $('ue-cancel-place').hidden = !s.placing;
      $('ue-place-status').hidden = !s.placing;
      $('ue-error').hidden = !s.error; $('ue-error').textContent=s.error;
    }
    draw();
  }
  async function load(id) {
    const s = projects.get(id); s.loading=true;s.error='';render();
    try {
      const response = await fetch(base(id),{signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw Error('load');
      const records=await response.json();
      if (!Array.isArray(records) || !records.every(valid) || new Set(records.map(item=>item.id)).size !== records.length) throw Error('invalid');
      s.records=records;s.loaded=true;
    } catch {s.loaded=false;}
    finally {s.loading=false;if (project?.id === id) render();}
  }
  $('ue-retry').onclick=()=>load(project.id);
  $('ue-new').onclick=()=>{const s=current();s.draft={name:'',longitude:'',latitude:''};s.draftId=`ue-${Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('')}`;s.editing=null;s.dirty=true;s.error='';render();$('ue-name').focus();};
  for (const field of ['name','longitude','latitude']) $('ue-'+field).oninput=event=>{
    const s=current();s.draft[field]=event.target.value;s.dirty=true;s.error='';$('ue-save-state').textContent='Unsaved';$('ue-save').disabled=s.placing;$('ue-new').disabled=true;document.querySelectorAll('#ue-list button').forEach(button=>{button.disabled=true;});$('ue-error').hidden=true;draw();
  };
  $('ue-place').onclick=()=>{current().placing=true;render();map.getCanvas().focus();};
  $('ue-cancel-place').onclick=()=>{current().placing=false;render();$('ue-place').focus();};
  $('ue-discard').onclick=()=>{const s=current();s.draft=null;s.editing=null;s.dirty=false;s.placing=false;s.error='';render();$('ue-new').focus();};
  $('ue-form').onsubmit=async event=>{
    event.preventDefault(); const s=current(), projectId=project.id;
    if (!s || s.saving || s.placing || !$('ue-form').reportValidity()) return;
    if (!s.draft.name.trim()) {s.error='Enter a UE name.';render();return;}
    const id=s.editing || s.draftId, payload={name:s.draft.name,longitude:Number(s.draft.longitude),latitude:Number(s.draft.latitude)};
    s.saving=true;s.error='';render();
    try {
      const response=await fetch(`${base(projectId)}/${encodeURIComponent(id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw Error('save');
      const saved=await response.json();if (!valid(saved) || saved.id !== id) throw Error('invalid');
      s.records=s.records.filter(item=>item.id !== id);s.records.push(saved);s.records.sort((a,b)=>a.name.localeCompare(b.name));
      s.editing=id;s.draft={name:saved.name,longitude:String(saved.longitude),latitude:String(saved.latitude)};s.dirty=false;
    } catch {s.error='Could not save the virtual UE. Your draft is still available; retry Save.';}
    finally {s.saving=false;if(project?.id===projectId) render();}
  };
  $('ue-delete').onclick=async()=>{
    const s=current(),projectId=project.id,id=s.editing;
    if (!id || !confirm(`Delete virtual UE ${s.draft.name}?`)) return;
    s.saving=true;s.error='';render();
    try {
      const response=await fetch(`${base(projectId)}/${encodeURIComponent(id)}`,{method:'DELETE',signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw Error('delete');
      s.records=s.records.filter(item=>item.id!==id);s.draft=null;s.editing=null;s.dirty=false;
    } catch {s.error='Could not delete the virtual UE. Please try again.';}
    finally {s.saving=false;if(project?.id===projectId) render();}
  };
  $('ue-overview').onclick=showProjectOverview;
  document.addEventListener('contextchange',event=>{active=event.detail==='ue-panel';if(!active && current()) current().placing=false;render();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && active && current()?.placing){event.stopImmediatePropagation();current().placing=false;render();$('ue-place').focus();}},true);
  window.addEventListener('beforeunload',event=>{if([...projects.values()].some(s=>s.dirty || s.saving)){event.preventDefault();event.returnValue='';}});
  return {
    selectProject(value) {
      if (current()) current().placing=false;
      project=value;
      if (!projects.has(value.id)) projects.set(value.id,{records:[],loaded:false,loading:false,draft:null,editing:null,dirty:false,saving:false,placing:false,error:''});
      const s=current(); if(!s.loaded && !s.loading) load(value.id); else render();
    },
    click(event) {
      const s=current();if(!active || !s?.placing) return false;
      const longitude=((event.lngLat.lng+180)%360+360)%360-180;
      s.draft.longitude=String(Number(longitude.toFixed(7)));s.draft.latitude=String(Number(event.lngLat.lat.toFixed(7)));s.placing=false;s.dirty=true;render();$('ue-place').focus();return true;
    },
    initialize() {
      map.addSource('virtual-ues',{type:'geojson',data:features()});
      map.addLayer({id:'virtual-ue-points',type:'circle',source:'virtual-ues',paint:{'circle-radius':7,'circle-color':['case',['get','draft'],'#d4862d','#6b4ca5'],'circle-stroke-color':'#fff','circle-stroke-width':2}});
      draw();
    },
  };
}
