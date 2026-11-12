export function driveTestUrl(regionId,projectId,taskId,routeId) {
  const pairs=[['region',regionId],['project',projectId],['task',taskId],['route',routeId]].filter(([,value])=>value);
  return '/drive-test/?'+pairs.map(([key,value])=>`${key}=${encodeURIComponent(value)}`).join('&');
}
