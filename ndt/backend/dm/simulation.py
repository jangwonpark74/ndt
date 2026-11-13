"""Deterministic fixed-height UMa planning-power simulation, without service KPIs."""
from bisect import bisect_right
import math

from .integration import distance, route_lengths
from .antenna import antenna_attenuation,initial_bearing,array_far_field_distance,peak_eirp
from ..cell_assignments import cell_eirp,transmitter_rat,power_sum,CELL_RADIO_FIELDS,validate_cell_power_change
from ..radio_scenarios import validate_radio_template
from .model_versions import LEGACY_UMA as MODEL,DIRECTIONAL_UMA as DIRECTIONAL_MODEL,ARRAY_UMA,CELL_UMA

def model_for(snapshot):
    model=snapshot.get('predictionModel',MODEL)
    if model not in (MODEL,DIRECTIONAL_MODEL,ARRAY_UMA,CELL_UMA):raise ValueError('The frozen prediction model is unavailable; it cannot be reinterpreted as a different model.')
    if bool(snapshot.get('radioScenario'))!=(model in (DIRECTIONAL_MODEL,ARRAY_UMA,CELL_UMA)):raise ValueError('The frozen model and scenario inputs do not match.')
    if model!=CELL_UMA and any('ports' in t for t in snapshot['transmitters']+snapshot.get('baselineTransmitters',[])):raise ValueError('Source-cell port inputs require the source-cell prediction model')
    if model==DIRECTIONAL_MODEL and any(t.get('template',{}).get('pattern')=='array' for t in snapshot['transmitters']+snapshot.get('baselineTransmitters',[])):raise ValueError('Array inputs require the uniform-panel prediction model.')
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
    model=model_for(snapshot);directional=model in (DIRECTIONAL_MODEL,ARRAY_UMA)
    if model==CELL_UMA:return simulate_cells(snapshot,case,powers,interval_s=interval_s,rat=rat,time_origin=time_origin,cancelled=cancelled)
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
        candidates = [];array_excluded=False;below_output=False
        for transmitter in transmitters:
            receiver=[position['longitude'],position['latitude']]
            separation=distance(receiver,transmitter['coordinates'])
            template=transmitter.get('template') if directional else None
            if directional and template['pattern']=='array' and math.hypot(separation,23.5)<array_far_field_distance(template):
                array_excluded=True;continue
            loss = path_loss(separation,template['frequencyMHz'] if directional else transmitter['frequency_mhz'],template['mode'] if directional else mode)
            if loss is not None:
                if directional and template['pattern']!='isotropic':
                    elevation=math.degrees(math.atan2(1.5-25,separation))
                    bearing=initial_bearing(transmitter['coordinates'],receiver)
                    loss+=antenna_attenuation(template,bearing-template['azimuthDeg'],elevation)
                received=powers[transmitter['id']]-loss
                if model==ARRAY_UMA and received < -300:
                    below_output=True;continue
                candidates.append((received, transmitter['id']))
        row = dict(**position, rat=rat, leg_id=snapshot['route']['id'])
        if candidates:
            received, identity = max(candidates)
            row.update(predicted_rx_dbm=received, cell_id='PLAN:'+identity)
        else:
            row['event'] = ('Below supported planning-power output range (-300 dBm)' if below_output else
                            'No supported transmitter outside its array far-field boundary' if array_excluded else
                            'Outside supported model distance or frequency range')
        rows.append(row)
    return rows


def simulate_cells(snapshot,case,powers,*,interval_s,rat,time_origin,cancelled):
    transmitters=snapshot['transmitters'];rows=[]
    if any('ports' in t for t in transmitters):validate_cell_power_change(transmitters,snapshot['radioScenario']['payload']['radioBudgets'])
    for transmitter in transmitters:
        common=None
        for port in transmitter.get('ports',[{'template':transmitter.get('template')}]):
            template=port['template']
            # Frozen qualification stays pinned; later live band tables are not consulted.
            validate_radio_template({key:value for key,value in template.items() if key!='carrier'})
            if 'ports' in transmitter:
                ref=template.get('equipmentSource')
                if not ref or ref['cellId']!=transmitter['cellId'] or ref['linkId']!=port['linkId'] or template['rat']!=transmitter['rat']:raise ValueError('Frozen source-cell paths and RAT do not match their port templates')
                values=[template.get(key) for key in CELL_RADIO_FIELDS]
                if common is not None and common!=values:raise ValueError('Frozen cell ports must share their radio inputs')
                common=values
    transmitters=[t for t in transmitters if transmitter_rat(t)==rat]
    if not transmitters:raise ValueError(f'The frozen scenario has no {rat} transmitters.')
    for index,position in enumerate(trajectory(snapshot['route'],case['speedKmh'],interval_s,time_origin)):
        if index%100==0 and cancelled():raise InterruptedError('Experiment cancelled.')
        receiver=[position['longitude'],position['latitude']];candidates=[];near_field=False;below_output=False
        for transmitter in transmitters:
            separation=distance(receiver,transmitter['coordinates']);bearing=initial_bearing(transmitter['coordinates'],receiver)
            elevation=math.degrees(math.atan2(-23.5,separation));delta=powers[transmitter['id']]-cell_eirp(transmitter);port_values=[];supported=True
            for port in transmitter.get('ports',[{'template':transmitter.get('template')}]):
                template=port['template'];loss=path_loss(separation,template['frequencyMHz'],template['mode'])
                if loss is None:supported=False;break
                if template['pattern']=='array' and math.hypot(separation,23.5)<array_far_field_distance(template):supported=False;near_field=True;break
                port_values.append(peak_eirp(template)+delta-loss-antenna_attenuation(template,bearing-template['azimuthDeg'],elevation))
            if not supported:continue
            received=power_sum(port_values)
            if received < -300:below_output=True;continue
            candidates.append((received,transmitter['id']))
        row=dict(**position,rat=rat,leg_id=snapshot['route']['id'])
        if candidates:
            received,identity=max(candidates);row.update(predicted_rx_dbm=received,cell_id='PLAN:'+identity)
        else:row['event']=('Below supported planning-power output range (-300 dBm)' if below_output else 'No complete cell prediction meets all port far-field boundaries' if near_field else 'Outside supported model distance or frequency range')
        rows.append(row)
    return rows
