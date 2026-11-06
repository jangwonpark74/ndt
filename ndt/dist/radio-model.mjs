// 3GPP TR 38.901 v18.0.0, table 7.4.1-1, UMa mean path loss; fixed hBS=25 m and hUT=1.5 m.
export const RADIO_DEFAULTS = Object.freeze({mode:'NLOS',eirpDbm:46,thresholdDbm:-100});
const H_BS = 25, H_UT = 1.5, H_ENV = 1, MIN_DISTANCE = 10, MAX_DISTANCE = 5000, C = 3e8;

export function umaPathLoss(distanceM, frequencyMHz, mode = 'NLOS') {
  if (!Number.isFinite(distanceM) || distanceM < MIN_DISTANCE || distanceM > MAX_DISTANCE ||
      !Number.isFinite(frequencyMHz) || frequencyMHz < 500 || frequencyMHz > 100000 || !['LOS','NLOS'].includes(mode)) return null;
  const frequencyGHz = frequencyMHz/1000, heightDifference = H_BS-H_UT;
  const distance3d = Math.hypot(distanceM,heightDifference);
  const breakpoint = 4*(H_BS-H_ENV)*(H_UT-H_ENV)*frequencyMHz*1e6/C;
  const los = distanceM <= breakpoint
    ? 28 + 22*Math.log10(distance3d) + 20*Math.log10(frequencyGHz)
    : 28 + 40*Math.log10(distance3d) + 20*Math.log10(frequencyGHz) - 9*Math.log10(breakpoint**2 + heightDifference**2);
  if (mode === 'LOS') return los;
  const nlos = 13.54 + 39.08*Math.log10(distance3d) + 20*Math.log10(frequencyGHz) - .6*(H_UT-1.5);
  return Math.max(los,nlos);
}

export function coverageRadius(frequencyMHz, scenario = RADIO_DEFAULTS) {
  const {mode,eirpDbm,thresholdDbm} = scenario;
  if (!Number.isFinite(eirpDbm) || eirpDbm < 0 || eirpDbm > 90 || !Number.isFinite(thresholdDbm) || thresholdDbm < -160 || thresholdDbm > -20 ||
      umaPathLoss(MIN_DISTANCE,frequencyMHz,mode) === null) return null;
  const budget = eirpDbm-thresholdDbm, minimum = umaPathLoss(MIN_DISTANCE,frequencyMHz,mode), maximum = umaPathLoss(MAX_DISTANCE,frequencyMHz,mode);
  if (budget < minimum) return {radiusM:0,status:'below-model-range'};
  if (budget >= maximum) return {radiusM:MAX_DISTANCE,status:'capped-at-5km'};
  let low = MIN_DISTANCE, high = MAX_DISTANCE;
  for (let i=0;i<48;i++) {
    const mid = (low+high)/2;
    if (umaPathLoss(mid,frequencyMHz,mode) <= budget) low = mid; else high = mid;
  }
  return {radiusM:low,status:'estimated'};
}
