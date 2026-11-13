"""Versioned full-sphere scalar realized-gain interpolation, not a polarized channel."""
from bisect import bisect_right
import math

GRID_MODEL='ndt.scalar-gain-grid.v1'
COORDINATES='boresight-clockwise-azimuth-up-elevation-v1'
REFERENCE_PLANE='antenna-input-total-realized-gain'
MAX_GRID_SAMPLES=250000
FIELDS={'format','coordinateSystem','referencePlane','interpolation','evidence','antennaModel','portNames','electricalState','electricalTiltDeg','maxDimensionM','frequencyMHz','azimuthDeg','elevationDeg','gainDbi','referenceImpedanceOhm','portConditions'}


def finite(value,low,high,label):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not low<=value<=high or not math.isfinite(value):raise ValueError(f'{label}: expected {low} to {high}')
    return value


def plain(value,limit,label):
    if not isinstance(value,str) or not value.strip() or len(value)>limit or any(ord(c)<32 for c in value):raise ValueError(f'{label}: nonempty plain text, maximum {limit} characters')


def _axis(values,low,high,maximum,label,full=False):
    if not isinstance(values,list) or not 2<=len(values)<=maximum:raise ValueError(f'{label}: expected 2 to {maximum} ordered samples')
    for value in values:finite(value,low,high,label)
    if any(a>=b for a,b in zip(values,values[1:])) or (full and (len(values)<3 or values[0]!=low or values[-1]!=high)):raise ValueError(f'{label}: strictly ordered full-domain coordinates required')
    return tuple(values)


def _interval(axis,value):
    i=min(len(axis)-2,max(0,bisect_right(axis,value)-1))
    return i,(value-axis[i])/(axis[i+1]-axis[i])


def _solid_angle_weights(a,b):
    mid=(a+b)/2;half=(b-a)/2
    # Stable exact integrals for linear gain times cos(elevation), including tiny cells.
    correction=(-half**2/3+half**4/30-half**6/840) if abs(half)<1e-3 else math.cos(half)-math.sin(half)/half
    common=math.cos(mid)*math.sin(half);offset=math.sin(mid)*correction
    return common-offset,common+offset


def local_direction(azimuth_offset_deg,elevation_deg,tilt_deg,roll_deg=0):
    finite(azimuth_offset_deg,-1e308,1e308,'Azimuth');finite(elevation_deg,-90,90,'Elevation');finite(tilt_deg,-20,90,'Mechanical downtilt');finite(roll_deg,-180,180,'Mechanical roll')
    az,e,t=map(math.radians,(azimuth_offset_deg%360,elevation_deg,tilt_deg))
    x=math.cos(e)*math.cos(az);y=math.cos(e)*math.sin(az);z=math.sin(e)
    local_x=math.cos(t)*x-math.sin(t)*z;local_z0=math.sin(t)*x+math.cos(t)*z;r=math.radians(roll_deg)
    local_y=math.cos(r)*y-math.sin(r)*local_z0;local_z=math.sin(r)*y+math.cos(r)*local_z0
    return math.degrees(math.atan2(local_y,local_x)),math.degrees(math.asin(max(-1,min(1,local_z))))


class ScalarGainGrid:
    def __init__(self,data):
        if not isinstance(data,dict) or set(data)!=FIELDS:raise ValueError('A complete versioned scalar radiation grid is required')
        if data['format']!=GRID_MODEL or data['coordinateSystem']!=COORDINATES or data['referencePlane']!=REFERENCE_PLANE or data['interpolation']!='linear-power':raise ValueError('Unsupported scalar-grid format, coordinates, reference plane or interpolation')
        if data['evidence'] not in ('measured','vendor-simulated','analytical-test'):raise ValueError('Declare measured, vendor-simulated or analytical-test pattern evidence')
        finite(data['referenceImpedanceOhm'],1,1000,'Real reference impedance (ohm)')
        if data['portConditions']!='other-ports-matched-to-reference':raise ValueError('Declare other antenna ports matched to the real reference impedance')
        plain(data['antennaModel'],160,'Antenna model');plain(data['electricalState'],300,'Embedded electrical state')
        names=data['portNames']
        if not isinstance(names,list) or not 1<=len(names)<=64:raise ValueError('Declare 1 to 64 physical port names')
        for name in names:plain(name,160,'Port name')
        if len(set(names))!=len(names):raise ValueError('Port names must be unique')
        finite(data['electricalTiltDeg'],-20,90,'Embedded electrical tilt');finite(data['maxDimensionM'],.001,100,'Maximum antenna dimension (m)')
        self.frequency=_axis(data['frequencyMHz'],500,100000,16,'Frequency (MHz)')
        self.azimuth=_axis(data['azimuthDeg'],-180,180,721,'Azimuth (degrees)',True)
        self.elevation=_axis(data['elevationDeg'],-90,90,361,'Elevation (degrees)',True)
        self.sample_count=len(self.frequency)*len(self.azimuth)*len(self.elevation)
        if self.sample_count>MAX_GRID_SAMPLES:raise ValueError(f'Scalar-grid limit: {MAX_GRID_SAMPLES} samples')
        frames=data['gainDbi']
        if not isinstance(frames,list) or len(frames)!=len(self.frequency):raise ValueError('Grid needs one gain frame per frequency')
        powers=[];peaks=[];efficiencies=[]
        az_r=[math.radians(a) for a in self.azimuth];el_r=[math.radians(e) for e in self.elevation]
        weights=[_solid_angle_weights(a,b) for a,b in zip(el_r,el_r[1:])]
        for frame in frames:
            if not isinstance(frame,list) or len(frame)!=len(self.elevation):raise ValueError('Grid elevation dimension does not match its axis')
            rows=[]
            for row in frame:
                if not isinstance(row,list) or len(row)!=len(self.azimuth):raise ValueError('Grid azimuth dimension does not match its axis')
                for gain in row:finite(gain,-120,50,'Total realized gain (dBi)')
                if abs(row[0]-row[-1])>1e-6:raise ValueError('Grid azimuth seam must agree at -180 and 180 degrees')
                rows.append(tuple(10**(gain/10) for gain in row))
            if any(max(row)-min(row)>1e-6 for row in (frame[0],frame[-1])):raise ValueError('Grid pole gains must be independent of azimuth')
            az_integrals=[math.fsum((b-a)*(row[i]+row[i+1])/2 for i,(a,b) in enumerate(zip(az_r,az_r[1:]))) for row in rows]
            efficiency=math.fsum(az_integrals[i]*left+az_integrals[i+1]*right for i,(left,right) in enumerate(weights))/(4*math.pi)
            if efficiency>1+1e-6:raise ValueError('Interpolated total realized gain violates passive power conservation; refine the grid or correct gain conventions')
            efficiencies.append(efficiency);peaks.append(max(max(row) for row in rows));powers.append(tuple(rows))
        self.powers=tuple(powers);self.peaks=tuple(peaks);self.efficiencies=tuple(efficiencies);self.max_dimension_m=data['maxDimensionM']

    def check_carrier(self,frequency_mhz,bandwidth_mhz):
        finite(frequency_mhz,500,100000,'Frequency (MHz)');finite(bandwidth_mhz,.1,400,'Bandwidth (MHz)')
        if frequency_mhz-bandwidth_mhz/2<self.frequency[0]-1e-9 or frequency_mhz+bandwidth_mhz/2>self.frequency[-1]+1e-9:raise ValueError('The entire occupied carrier must lie within the source grid frequency coverage; no extrapolation')

    def _frequency(self,value):
        finite(value,self.frequency[0],self.frequency[-1],'Grid frequency (MHz)')
        return _interval(self.frequency,value)

    def gain(self,frequency_mhz,azimuth_deg,elevation_deg):
        f,fw=self._frequency(frequency_mhz);finite(azimuth_deg,-1e308,1e308,'Grid azimuth');finite(elevation_deg,-90,90,'Grid elevation')
        a,aw=_interval(self.azimuth,(azimuth_deg%360+180)%360-180);e,ew=_interval(self.elevation,elevation_deg)
        def angular(frame):
            low=frame[e][a]*(1-aw)+frame[e][a+1]*aw;high=frame[e+1][a]*(1-aw)+frame[e+1][a+1]*aw
            return low*(1-ew)+high*ew
        return angular(self.powers[f])*(1-fw)+angular(self.powers[f+1])*fw

    def peak_gain_dbi(self,frequency_mhz):
        f,weight=self._frequency(frequency_mhz)
        return 10*math.log10(self.peaks[f]*(1-weight)+self.peaks[f+1]*weight)

    def attenuation(self,frequency_mhz,azimuth_deg,elevation_deg):
        return max(0,self.peak_gain_dbi(frequency_mhz)-10*math.log10(self.gain(frequency_mhz,azimuth_deg,elevation_deg)))

    def far_field_m(self,frequency_mhz):
        self._frequency(frequency_mhz)
        return 2*self.max_dimension_m**2*frequency_mhz*1e6/3e8
