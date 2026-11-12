import {siteLabel} from './planning-model.mjs';

export function createPlanningLabels({map,onSelect,getSites,getSelected,getProjects,getProjectData,getActiveProject}) {
  let markers=[];
  function refresh() {
    markers.forEach(marker=>marker.remove()); markers=[];
    if (!document.getElementById('site-labels-toggle').checked) return;
    const occupied=[], bounds=map.getBounds(), selected=getSelected(), data=getProjectData();
    const overlays=[...document.querySelectorAll('.intro,#context-panel,.map-controls,.topbar')].filter(el=>el.offsetWidth && el.offsetHeight).map(el=>el.getBoundingClientRect());
    function add(coordinates,text,kind,click,force=false) {
      if (!bounds.contains(coordinates)) return;
      const p=map.project(coordinates), width=Math.min(210,text.length*7+20), box={x:p.x,y:p.y,w:width,h:26};
      if(!force && overlays.some(b=>p.x+width/2>b.left && p.x-width/2<b.right && p.y>b.top && p.y-40<b.bottom))return;
      if (!force && occupied.some(b=>Math.abs(b.x-box.x)<(b.w+box.w)/2 && Math.abs(b.y-box.y)<30)) return;
      occupied.push(box);
      const el=document.createElement(click ? 'button' : 'span');el.className=`planning-map-label ${kind}`;el.textContent=text;el.title=text;el.setAttribute('aria-label',click ? `Review ${text}` : text);
      if(click){el.type='button';el.onclick=event=>{event.stopPropagation();click();};}
      markers.push(new maplibregl.Marker({element:el,anchor:'bottom',offset:[0,kind === 'project-label' ? -28 : -12]}).setLngLat(coordinates).addTo(map));
    }
    for(const project of getProjects()) {
      const sites=data?.clusters.get(project.id);
      if(sites?.length) add(sites[0].geometry.coordinates,`${project.name} · Cluster (${sites.length} sites)`,'project-label',null,true);
    }
    if(selected) add(selected.geometry.coordinates,siteLabel(selected),'selected-label',()=>onSelect(selected),true);
    if(map.getZoom()<13) return;
    const projectIds=new Set((data?.clusters.get(getActiveProject()?.id) || []).map(s=>s.properties.site_id));
    const sites=getSites().filter(s=>s.properties.site_id !== selected?.properties.site_id).sort((a,b)=>Number(projectIds.has(b.properties.site_id))-Number(projectIds.has(a.properties.site_id)) || a.properties.site_id.localeCompare(b.properties.site_id));
    for(const site of sites) {
      if(markers.length>=45)break;
      add(site.geometry.coordinates,siteLabel(site),projectIds.has(site.properties.site_id) ? 'member-label' : '',()=>onSelect(site));
    }
  }
  map.on('moveend',refresh);
  document.getElementById('site-labels-toggle').onchange=refresh;
  return {refresh};
}
