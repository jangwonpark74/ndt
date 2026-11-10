export function driveDuration(seconds) {
  if (seconds < 1) return '<1 s';
  const total = Math.round(seconds), hours = Math.floor(total/3600), minutes = Math.floor(total%3600/60), remainder = total%60;
  return `${hours ? `${hours} h ` : ''}${hours || minutes ? `${minutes} min ` : ''}${remainder} s`;
}
export const driveGps = point => point ? `Lat ${point[1].toFixed(6)}°, Lon ${point[0].toFixed(6)}°` : 'Add a route';
export const driveDistance = km => km === null ? 'Add a route' : `${km.toFixed(3)} km`;
export function driveTime(metrics) {
  const cases=metrics.speedCases || [],values=cases.map(item=>item.durationSeconds).filter(Number.isFinite);
  if (cases.length>1 && values.length) return `${driveDuration(Math.min(...values))} – ${driveDuration(Math.max(...values))} (${cases.length} cases)`;
  return metrics.durationSeconds === null ? metrics.distanceKm === null ? 'Add a route' : 'Set drive speeds' : driveDuration(metrics.durationSeconds);
}
