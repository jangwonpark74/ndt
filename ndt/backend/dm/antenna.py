"""Reference element and normalized scalar panel array, matching the browser probe."""
import math
from ..pattern_models import local_direction

ARRAY_BOUNDS=dict(rows=(1,64),columns=(1,64),verticalSpacing=(.25,1),horizontalSpacing=(.25,1),steerAzimuthDeg=(-90,90),steerDowntiltDeg=(-90,90))


def validate_array(template):
    if template['pattern']!='array':
        if 'array' in template:raise ValueError('Array geometry requires the uniform panel array pattern')
        return
    array=template.get('array')
    if not isinstance(array,dict) or set(array)!=set(ARRAY_BOUNDS):raise ValueError('Enter all six array geometry and steering inputs')
    for key,(low,high) in ARRAY_BOUNDS.items():
        value=array[key]
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not low<=value<=high or not math.isfinite(value) or (key in ('rows','columns') and int(value)!=value):raise ValueError(f'Invalid array {key}: expected {low} to {high}; rows and columns must be whole numbers')


def array_attenuation(template,azimuth_offset_deg,elevation_deg):
    """Single-panel scalar array with unit-norm uniform weights and local steering."""
    a=template['array'];az,e,t=map(math.radians,(azimuth_offset_deg,elevation_deg,template['tiltDeg']))
    y=math.cos(e)*math.sin(az);z=math.sin(t)*math.cos(e)*math.cos(az)+math.cos(t)*math.sin(e)
    steer_az,steer_el=map(math.radians,(a['steerAzimuthDeg'],-a['steerDowntiltDeg']))
    def amplitude(count,phase):
        half=phase/2;den=math.sin(half)
        return 1 if abs(den)<1e-12 else min(1,abs(math.sin(count*half)/(count*den)))
    h=amplitude(a['columns'],2*math.pi*a['horizontalSpacing']*(y-math.cos(steer_el)*math.sin(steer_az)))
    v=amplitude(a['rows'],2*math.pi*a['verticalSpacing']*(z-math.sin(steer_el)))
    # Numerical floor for ideal coherent nulls, not a 3GPP propagation parameter.
    return max(0,min(120,-20*math.log10(max(1e-6,h*v))))


def peak_eirp(template):
    return template['powerDbm']+template['gainDbi']-template['lossDb']+(10*math.log10(template['array']['rows']*template['array']['columns']) if template['pattern']=='array' else 0)


def array_far_field_distance(template):
    a=template['array']
    return 2*(((a['rows']-1)*a['verticalSpacing'])**2+((a['columns']-1)*a['horizontalSpacing'])**2)*3e8/(template['frequencyMHz']*1e6)


def antenna_attenuation(template,azimuth_offset_deg,elevation_deg,pattern_assets=None):
    if template['pattern']=='sampled':
        identity=template['sampled']['patternId']
        if not pattern_assets or identity not in pattern_assets:raise ValueError('The imported scalar grid requires its qualified frozen source model')
        az,el=local_direction(azimuth_offset_deg,elevation_deg,template['tiltDeg'],template['sampled']['rollDeg'])
        return pattern_assets[identity].attenuation(template['frequencyMHz'],az,el)
    if template['pattern']=='isotropic':return 0
    return element_attenuation(azimuth_offset_deg,elevation_deg,template['tiltDeg'])+(array_attenuation(template,azimuth_offset_deg,elevation_deg) if template['pattern']=='array' else 0)


def element_attenuation(azimuth_offset_deg,elevation_deg,tilt_deg=0):
    azimuth,elevation,tilt=map(math.radians,(azimuth_offset_deg,elevation_deg,tilt_deg))
    x=math.cos(elevation)*math.cos(azimuth);y=math.cos(elevation)*math.sin(azimuth);z=math.sin(elevation)
    local_x=math.cos(tilt)*x-math.sin(tilt)*z
    local_z=math.sin(tilt)*x+math.cos(tilt)*z
    phi=math.degrees(math.atan2(y,local_x));theta=math.degrees(math.acos(max(-1,min(1,local_z))))
    return min(30,min(30,12*(phi/65)**2)+min(30,12*((theta-90)/65)**2))


def initial_bearing(origin,target):
    lon1,lat1=map(math.radians,origin[:2]);lon2,lat2=map(math.radians,target[:2])
    delta=lon2-lon1
    return math.degrees(math.atan2(math.sin(delta)*math.cos(lat2),
                                  math.cos(lat1)*math.sin(lat2)-math.sin(lat1)*math.cos(lat2)*math.cos(delta)))%360


def far_field_distance(template,pattern_assets=None):
    if template['pattern']=='array':return array_far_field_distance(template)
    if template['pattern']=='sampled':
        if not pattern_assets or template['sampled']['patternId'] not in pattern_assets:raise ValueError('Missing qualified source grid for far-field evaluation')
        return pattern_assets[template['sampled']['patternId']].far_field_m(template['frequencyMHz'])
    return 0
