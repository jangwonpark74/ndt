// Scalar total realized gain only; phase and receiver polarization are outside this model.
export const GRID_MODEL='ndt.scalar-gain-grid.v1';
export const GRID_COORDINATES='boresight-clockwise-azimuth-up-elevation-v1';
export const GRID_REFERENCE_PLANE='antenna-input-total-realized-gain';
export const MAX_GRID_SAMPLES=250000;
const fields=['format','coordinateSystem','referencePlane','interpolation','evidence','antennaModel','portNames','electricalState','electricalTiltDeg','maxDimensionM','frequencyMHz','azimuthDeg','elevationDeg','gainDbi','referenceImpedanceOhm','portConditions'];
const rad=Math.PI/180;
function finite(value,low,high,label){if(!Number.isFinite(value) || value<low || value>high)throw Error(`${label}: expected ${low} to ${high}.`);return value;}
function plain(value,limit,label){if(typeof value!=='string' || !value.trim() || value.length>limit || /[\u0000-\u001f]/.test(value))throw Error(`${label}: nonempty plain text, maximum ${limit} characters.`);}
function axis(values,low,high,maximum,label,full=false){
 if(!Array.isArray(values) || values.length<2 || values.length>maximum)throw Error(`${label}: expected 2 to ${maximum} ordered samples.`);
 for(const value of values)finite(value,low,high,label);
 if(values.some((v,i)=>i && v<=values[i-1]) || (full && (values.length<3 || values[0]!==low || values.at(-1)!==high)))throw Error(`${label}: strictly ordered full-domain coordinates required.`);
 return [...values];
}
function interval(values,value){let low=0,high=values.length;while(low<high){const mid=(low+high)>>1;if(values[mid]<=value)low=mid+1;else high=mid;}const i=Math.min(values.length-2,Math.max(0,low-1));return [i,(value-values[i])/(values[i+1]-values[i])];}
function solidAngleWeights(a,b){const mid=(a+b)/2,h=(b-a)/2,correction=Math.abs(h)<1e-3?-h*h/3+h**4/30-h**6/840:Math.cos(h)-Math.sin(h)/h,common=Math.cos(mid)*Math.sin(h),offset=Math.sin(mid)*correction;return [common-offset,common+offset];}
export function localDirection(azimuthOffsetDeg,elevationDeg,tiltDeg,rollDeg=0){
 finite(azimuthOffsetDeg,-1e308,1e308,'Azimuth');finite(elevationDeg,-90,90,'Elevation');finite(tiltDeg,-20,90,'Mechanical downtilt');finite(rollDeg,-180,180,'Mechanical roll');
 const a=(azimuthOffsetDeg%360)*rad,e=elevationDeg*rad,t=tiltDeg*rad,r=rollDeg*rad,x=Math.cos(e)*Math.cos(a),y=Math.cos(e)*Math.sin(a),z=Math.sin(e),lx=Math.cos(t)*x-Math.sin(t)*z,z0=Math.sin(t)*x+Math.cos(t)*z,ly=Math.cos(r)*y-Math.sin(r)*z0,lz=Math.sin(r)*y+Math.cos(r)*z0;
 return [Math.atan2(ly,lx)/rad,Math.asin(Math.max(-1,Math.min(1,lz)))/rad];
}
export function prepareGrid(data){
 if(!data || typeof data!=='object' || Array.isArray(data) || Object.keys(data).sort().join(',')!==[...fields].sort().join(','))throw Error('A complete versioned scalar radiation grid is required.');
 if(data.format!==GRID_MODEL || data.coordinateSystem!==GRID_COORDINATES || data.referencePlane!==GRID_REFERENCE_PLANE || data.interpolation!=='linear-power')throw Error('Unsupported scalar-grid format, coordinates, reference plane or interpolation.');
 if(!['measured','vendor-simulated','analytical-test'].includes(data.evidence))throw Error('Declare measured, vendor-simulated or analytical-test pattern evidence.');
 finite(data.referenceImpedanceOhm,1,1000,'Real reference impedance (ohm)');if(data.portConditions!=='other-ports-matched-to-reference')throw Error('Declare other antenna ports matched to the real reference impedance.');
 plain(data.antennaModel,160,'Antenna model');plain(data.electricalState,300,'Embedded electrical state');
 if(!Array.isArray(data.portNames) || !data.portNames.length || data.portNames.length>64)throw Error('Declare 1 to 64 physical port names.');
 for(const name of data.portNames)plain(name,160,'Port name');if(new Set(data.portNames).size!==data.portNames.length)throw Error('Port names must be unique.');
 finite(data.electricalTiltDeg,-20,90,'Embedded electrical tilt');const dimension=finite(data.maxDimensionM,.001,100,'Maximum antenna dimension (m)');
 const frequency=axis(data.frequencyMHz,500,100000,16,'Frequency (MHz)'),azimuth=axis(data.azimuthDeg,-180,180,721,'Azimuth (degrees)',true),elevation=axis(data.elevationDeg,-90,90,361,'Elevation (degrees)',true),sampleCount=frequency.length*azimuth.length*elevation.length;
 if(sampleCount>MAX_GRID_SAMPLES)throw Error(`Scalar-grid limit: ${MAX_GRID_SAMPLES} samples.`);
 if(!Array.isArray(data.gainDbi) || data.gainDbi.length!==frequency.length)throw Error('Grid needs one gain frame per frequency.');
 const powers=[],peaks=[],efficiencies=[],weights=elevation.slice(0,-1).map((e,i)=>solidAngleWeights(e*rad,elevation[i+1]*rad));
 for(const frame of data.gainDbi){
  if(!Array.isArray(frame) || frame.length!==elevation.length)throw Error('Grid elevation dimension does not match its axis.');
  const rows=frame.map(row=>{if(!Array.isArray(row) || row.length!==azimuth.length)throw Error('Grid azimuth dimension does not match its axis.');for(const gain of row)finite(gain,-120,50,'Total realized gain (dBi)');if(Math.abs(row[0]-row.at(-1))>1e-6)throw Error('Grid azimuth seam must agree at -180 and 180 degrees.');return row.map(gain=>10**(gain/10));});
  for(const row of [frame[0],frame.at(-1)])if(Math.max(...row)-Math.min(...row)>1e-6)throw Error('Grid pole gains must be independent of azimuth.');
  const integrals=rows.map(row=>azimuth.slice(0,-1).reduce((n,a,i)=>n+(azimuth[i+1]-a)*rad*(row[i]+row[i+1])/2,0)),efficiency=weights.reduce((n,[a,b],i)=>n+integrals[i]*a+integrals[i+1]*b,0)/(4*Math.PI);
  if(efficiency>1+1e-6)throw Error('Interpolated total realized gain violates passive power conservation; refine the grid or correct gain conventions.');
  efficiencies.push(efficiency);peaks.push(Math.max(...rows.map(row=>Math.max(...row))));powers.push(rows);
 }
 const frequencyInterval=f=>{finite(f,frequency[0],frequency.at(-1),'Grid frequency (MHz)');return interval(frequency,f);};
 const gain=(f,a,e)=>{
  const [fi,fw]=frequencyInterval(f);finite(a,-1e308,1e308,'Grid azimuth');finite(e,-90,90,'Grid elevation');
  const az=((a%360+540)%360)-180,[ai,aw]=interval(azimuth,az),[ei,ew]=interval(elevation,e);
  const angular=frame=>(frame[ei][ai]*(1-aw)+frame[ei][ai+1]*aw)*(1-ew)+(frame[ei+1][ai]*(1-aw)+frame[ei+1][ai+1]*aw)*ew;
  return angular(powers[fi])*(1-fw)+angular(powers[fi+1])*fw;
 };
 const peakGainDbi=f=>{const [i,w]=frequencyInterval(f);return 10*Math.log10(peaks[i]*(1-w)+peaks[i+1]*w);};
 return {sampleCount,efficiencies,peakGainDbi,gain,attenuation:(f,a,e)=>Math.max(0,peakGainDbi(f)-10*Math.log10(gain(f,a,e))),
  checkCarrier(f,bw){finite(f,500,100000,'Frequency (MHz)');finite(bw,.1,400,'Bandwidth (MHz)');if(f-bw/2<frequency[0]-1e-9 || f+bw/2>frequency.at(-1)+1e-9)throw Error('The entire occupied carrier must lie within the source grid frequency coverage; no extrapolation.');},
  farFieldM(f){frequencyInterval(f);return 2*dimension**2*f*1e6/3e8;},
 };
}

export const patternEvidenceLabel=value=>({'analytical-test':'Analytical test data','vendor-simulated':'Vendor simulation - source claim',measured:'Measured pattern - source claim'}[value] || 'Unspecified source claim');
