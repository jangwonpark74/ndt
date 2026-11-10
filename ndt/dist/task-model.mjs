import {validateTasks, roadGuidePoints} from './task-data.mjs';

export function createTaskModel(regionId, request = fetch) {
  const url = projectId => `/api/regions/${encodeURIComponent(regionId)}/projects/${encodeURIComponent(projectId)}/tasks`;
  return {
    async fit(route, signal) {
      const original = route.waypoints || route.coordinates;
      const waypoints = roadGuidePoints(original);
      const response = await request('/api/road-route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(waypoints),signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Road routing unavailable. The original path is kept.');
      const fitted = {...route,coordinates:result.coordinates,waypoints,roadFit:'fitted',fitMessage:`Road fitted · ${waypoints.length} guide points${original.length > waypoints.length ? ` from ${original.length} input points` : ''}`};
      validateTasks([{id:'fitted',name:'Fitted route',routes:[fitted]}]);
      return fitted;
    },
    async load(projectId) {
      const response = await request(url(projectId),{signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error('Tasks could not be loaded. Retry to keep saved tasks safe.');
      return validateTasks(await response.json());
    },
    async save(projectId, tasks) {
      validateTasks(tasks);
      const response = await request(url(projectId),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(tasks.map(({driveMetrics,...task})=>task)),signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error('Tasks could not be saved. Your draft is still available; retry Save.');
      const saved = await response.json();
      return validateTasks(Array.isArray(saved) ? saved : tasks);
    },
  };
}
