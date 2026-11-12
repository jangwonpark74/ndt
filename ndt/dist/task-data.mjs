import {distanceMetres} from './project-coverage.mjs?v=cluster-2';

export function taskSpeedCases(task) {
  if (Array.isArray(task?.speedCases)) return task.speedCases;
  return task?.driveSpeedKmh == null ? [] : [{id:'CASE-001',name:`${task.driveSpeedKmh} km/h`,speedKmh:task.driveSpeedKmh}];
}

export function parseSpeedCases(text, existing = []) {
  if (!text.trim()) return [];
  const values=text.split(',').map(value=>value.trim());
  if (values.length>20 || values.some(value=>! /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || Number(value)<.1 || Number(value)>200)) throw new Error('Enter up to 20 speeds from 0.1 to 200 km/h, separated by commas.');
  const speeds=values.map(Number);
  if (new Set(speeds).size!==speeds.length) throw new Error('Each speed case must have a different speed.');
  const reserved=new Set(existing.filter(item=>speeds.includes(item.speedKmh)).map(item=>item.id)),used=new Set();
  return speeds.map((speed,index)=>{
    const found=existing.find(item=>item.speedKmh===speed);if(found){used.add(found.id);return found;}
    const previous=existing[index];
    if(previous && !reserved.has(previous.id) && !used.has(previous.id)){used.add(previous.id);return {...previous,name:previous.name===`${previous.speedKmh} km/h`?`${speed} km/h`:previous.name,speedKmh:speed};}
    let next=1;while(used.has(`CASE-${String(next).padStart(3,'0')}`)||reserved.has(`CASE-${String(next).padStart(3,'0')}`))next++;
    const id=`CASE-${String(next).padStart(3,'0')}`;used.add(id);return {id,name:`${speed} km/h`,speedKmh:speed};
  });
}

export function validateTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length > 100) throw new Error('Use at most 100 tasks per project.');
  const ids = new Set(); let count = 0;
  const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
  const validName = name => typeof name === 'string' && name.trim() && name.length <= 120;
  for (const task of tasks) {
    if (!task || !validId(task.id) || ids.has(task.id)) throw new Error('Task IDs must be unique: use 1–64 letters, numbers, hyphens or underscores.');
    ids.add(task.id);
    if (!validName(task.name)) throw new Error('Enter a task name (up to 120 characters).');
    if (task.driveSpeedKmh != null && (!Number.isFinite(task.driveSpeedKmh) || task.driveSpeedKmh < 0.1 || task.driveSpeedKmh > 200)) throw new Error('Drive speed must be between 0.1 and 200 km/h, or left blank.');
    const cases=taskSpeedCases(task),caseIds=new Set(),caseSpeeds=new Set();
    if (task.speedCases !== undefined && !Array.isArray(task.speedCases) || cases.length>20) throw new Error('Use at most 20 speed cases.');
    for (const item of cases) {
      if (!item || !validId(item.id) || caseIds.has(item.id) || !validName(item.name) || !Number.isFinite(item.speedKmh) || item.speedKmh<.1 || item.speedKmh>200 || caseSpeeds.has(item.speedKmh)) throw new Error('Speed cases need unique IDs and speeds from 0.1 to 200 km/h.');
      caseIds.add(item.id);caseSpeeds.add(item.speedKmh);
    }
    if (!Array.isArray(task.routes) || task.routes.length > 50) throw new Error('Use at most 50 routes per task.');
    const routeIds = new Set();
    for (const route of task.routes) {
      if (!route || !validId(route.id) || routeIds.has(route.id) || !validName(route.name)) throw new Error('Each route needs a unique ID and a name.');
      routeIds.add(route.id);
      const points = route.coordinates;
      if (!Array.isArray(points) || points.length < 2 || points.length > 5000) throw new Error('Each route needs 2–5,000 points.');
      for (const point of points) {
        if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error('Use valid longitude/latitude coordinates.');
      }
      if (points.every(point => point[0] === points[0][0] && point[1] === points[0][1])) throw new Error('A route needs at least two distinct points.');
      if (route.roadFit !== undefined && !['fitted','unmatched'].includes(route.roadFit)) throw new Error('Invalid road fitting status.');
      if (route.fitMessage !== undefined && (typeof route.fitMessage !== 'string' || route.fitMessage.length > 240)) throw new Error('Invalid road fitting message.');
      if (route.waypoints !== undefined) {
        validateTasks([{id:'guides',name:'Guide points',routes:[{id:'guides',name:'Guide points',coordinates:route.waypoints}]}]);
        if (route.waypoints.length > 100) throw new Error('Use at most 100 road-routing guide points.');
      }
      if(route.originalCoordinates!==undefined)validateTasks([{id:'original',name:'Original path',routes:[{id:'original',name:'Original path',coordinates:route.originalCoordinates}]}]);
      count += points.length;
      if (count > 10000) throw new Error('Use at most 10,000 route points per project.');
    }
  }
  return tasks;
}

export function taskDriveMetrics(task) {
  const definitions=taskSpeedCases(task);
  const cases=definitions.every(item=>Number.isFinite(item.speedKmh) && item.speedKmh>=.1 && item.speedKmh<=200) ? definitions : [];
  const speedKmh=cases[0]?.speedKmh ?? null;
  const routes=(task?.routes || []).map(route=>{
    const points=route.coordinates,distanceKm=points.slice(1).reduce((sum,point,index)=>sum+distanceMetres(points[index],point),0)/1000;
    return {id:route.id,distanceKm,durationSeconds:speedKmh ? distanceKm/speedKmh*3600 : null,start:points[0],end:points.at(-1),speedCases:cases.map(item=>({...item,durationSeconds:distanceKm/item.speedKmh*3600}))};
  });
  const distanceKm=routes.length ? routes.reduce((sum,route)=>sum+route.distanceKm,0) : null;
  const start=routes[0]?.start || null,end=routes.at(-1)?.end || null;
  return {speedKmh,routes,distanceKm,durationSeconds:distanceKm!==null && speedKmh ? distanceKm/speedKmh*3600 : null,start,end,
    provisional:(task?.routes || []).some(route=>route.roadFit!=='fitted'),
    speedCases:cases.map(item=>({...item,distanceKm,durationSeconds:distanceKm===null?null:distanceKm/item.speedKmh*3600,start,end,routes:routes.map(route=>({id:route.id,durationSeconds:route.distanceKm/item.speedKmh*3600}))}))};
}

export function importRoutes(geojson, existing = []) {
  const routes = [], used = new Set(existing.map(route => route.id));
  function add(geometry, name) {
    if (geometry?.type === 'MultiLineString') {
      geometry.coordinates.forEach((coordinates, index) => add({type:'LineString',coordinates},`${name || 'Imported route'} ${index+1}`));
      return;
    }
    if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)) throw new Error('Import LineString or MultiLineString GeoJSON only.');
    let index = 1; while (used.has(`route-${index}`)) index++;
    const id = `route-${index}`; used.add(id);
    routes.push({id,name:name || `Route ${index}`,coordinates:geometry.coordinates.map(point => Array.isArray(point) && point.length >= 2 ? point.slice(0,2) : point)});
  }
  function read(value) {
    if (value?.type === 'FeatureCollection' && Array.isArray(value.features)) value.features.forEach(read);
    else if (value?.type === 'Feature') add(value.geometry,value.properties?.name);
    else add(value);
  }
  read(geojson);
  if (!routes.length) throw new Error('The GeoJSON contains no routes.');
  validateTasks([{id:'import',name:'Import',routes:[...existing,...routes]}]);
  return routes;
}

export function routeFeatures(routes) {
  const features = [];
  for (const route of routes) {
    const coordinates = route.coordinates;
    if (coordinates.length >= 2) features.push({type:'Feature',properties:{kind:'route',name:route.name,road_fitted:route.roadFit === 'fitted'},geometry:{type:'LineString',coordinates}});
    if (coordinates.length) {
      for (const [kind,point] of [['Start',coordinates[0]],['End',coordinates.at(-1)]]) {
        features.push({type:'Feature',properties:{kind,name:route.name},geometry:{type:'Point',coordinates:point}});
      }
    }
  }
  return {type:'FeatureCollection',features};
}

// Retain endpoints and the largest bends when a dense imported path exceeds the service's waypoint budget.
export function roadGuidePoints(points, limit = 100) {
  if (points.length <= limit) return points;
  const scale = Math.cos(points[0][1] * Math.PI / 180);
  function section(start,end) {
    const a=points[start], b=points[end], dx=(b[0]-a[0])*scale, dy=b[1]-a[1], length=dx*dx+dy*dy;
    let index=-1, error=0;
    for (let i=start+1;i<end;i++) {
      const x=(points[i][0]-a[0])*scale,y=points[i][1]-a[1];
      const t=length ? Math.max(0,Math.min(1,(x*dx+y*dy)/length)) : 0;
      const distance=(x-t*dx)**2+(y-t*dy)**2;
      if (distance > error) {error=distance;index=i;}
    }
    return {start,end,index,error};
  }
  const selected = new Set([0,points.length-1]), sections=[section(0,points.length-1)];
  while (selected.size < limit && sections.length) {
    sections.sort((a,b)=>b.error-a.error);
    const next=sections.shift();
    if (next.index < 0) break;
    selected.add(next.index);
    sections.push(section(next.start,next.index),section(next.index,next.end));
  }
  return [...selected].sort((a,b)=>a-b).map(index=>points[index]);
}
