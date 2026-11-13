"""TR 38.901 v18.0.0 table 7.3-1 reference element, matching the browser probe."""
import math


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
