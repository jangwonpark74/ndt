"""Deterministic fixed-height UMa planning-power simulation, without service KPIs."""
from bisect import bisect_right
import math

from .integration import distance, route_lengths
from .antenna import element_attenuation,initial_bearing
from ..radio_scenarios import validate_radio_template
from .model_versions import LEGACY_UMA as MODEL,DIRECTIONAL_UMA as DIRECTIONAL_MODEL

def model_for(snapshot):
    model=snapshot.get('predictionModel',MODEL)
    if model not in (MODEL,DIRECTIONAL_MODEL):raise ValueError('The frozen prediction model is unavailable; it cannot be reinterpreted as a different model.')
    if bool(snapshot.get('radioScenario'))!=(model==DIRECTIONAL_MODEL):raise ValueError('The frozen model and scenario inputs do not match.')
    return model


def path_loss(distance_m, frequency_mhz, mode):
    if not 10 <= distance_m <= 5000 or not 500 <= frequency_mhz <= 100000 or mode not in ('LOS', 'NLOS'):
        return None
    height_delta = 25-1.5
    d3 = math.hypot(distance_m, height_delta)
    fc = frequency_mhz/1000
    breakpoint = 4*(25-1)*(1.5-1)*frequency_mhz*1e6/3e8
    los = (28+22*math.log10(d3)+20*math.log10(fc) if distance_m <= breakpoint else
           28+40*math.log10(d3)+20*math.log10(fc)-9*math.log10(breakpoint**2+height_delta**2))
    nlos = 13.54+39.08*math.log10(d3)+20*math.log10(fc)-.6*(1.5-1.5)
    return los if mode == 'LOS' else max(los, nlos)


def trajectory(route, speed_kmh, interval_s, time_origin):
    coordinates = route['coordinates']
    lengths = route_lengths(coordinates)
    duration_ms = lengths[-1]/(speed_kmh/3.6)*1000
    offsets = [i*interval_s*1000 for i in range(math.ceil(duration_ms/(interval_s*1000)))]
    offsets.append(duration_ms)
    previous = -1
    for offset in offsets:
        chainage = min(lengths[-1], offset/1000*speed_kmh/3.6)
        index = min(len(coordinates)-2, max(0, bisect_right(lengths, chainage)-1))
        a, b = coordinates[index:index+2]
        span = lengths[index+1]-lengths[index]
        share = (chainage-lengths[index])/span if span else 0
        lon, lat = [a[k]+(b[k]-a[k])*share for k in (0, 1)]
        if offset == duration_ms:
            lon, lat = coordinates[-1]
        stamp = max(previous+1, round(time_origin+offset))
        previous = stamp
        yield dict(t=stamp, longitude=lon, latitude=lat, chainage_m=chainage)


def simulate(snapshot, case, powers, *, interval_s, rat, mode, time_origin, cancelled):
    rows = []
    directional=model_for(snapshot)==DIRECTIONAL_MODEL
    transmitters=snapshot['transmitters']
    if directional:
        for transmitter in transmitters:
            template=transmitter.get('template')
            # Qualification is frozen at submission; execution must not reinterpret a later band plan.
            validate_radio_template({k:v for k,v in template.items() if k!='carrier'} if isinstance(template,dict) else template)
        transmitters=[t for t in transmitters if t['template']['rat']==rat]
        if not transmitters:raise ValueError(f'The frozen scenario has no {rat} transmitters.')
    for index, position in enumerate(trajectory(snapshot['route'], case['speedKmh'], interval_s, time_origin)):
        if index % 100 == 0 and cancelled():
            raise InterruptedError('Experiment cancelled.')
        candidates = []
        for transmitter in transmitters:
            receiver=[position['longitude'],position['latitude']]
            separation=distance(receiver,transmitter['coordinates'])
            template=transmitter.get('template') if directional else None
            loss = path_loss(separation,template['frequencyMHz'] if directional else transmitter['frequency_mhz'],template['mode'] if directional else mode)
            if loss is not None:
                if directional and template['pattern']=='element':
                    elevation=math.degrees(math.atan2(1.5-25,separation))
                    bearing=initial_bearing(transmitter['coordinates'],receiver)
                    loss+=element_attenuation(bearing-template['azimuthDeg'],elevation,template['tiltDeg'])
                candidates.append((powers[transmitter['id']]-loss, transmitter['id']))
        row = dict(**position, rat=rat, leg_id=snapshot['route']['id'])
        if candidates:
            received, identity = max(candidates)
            row.update(predicted_rx_dbm=received, cell_id='PLAN:'+identity)
        else:
            row['event'] = 'Outside supported model distance or frequency range'
        rows.append(row)
    return rows
