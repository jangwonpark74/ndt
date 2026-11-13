"""Deterministic fixed-height UMa planning-power simulation, without service KPIs."""
from bisect import bisect_right
import math

from .integration import distance, route_lengths
from .antenna import antenna_attenuation,initial_bearing,array_far_field_distance,peak_eirp,far_field_distance,receiver_antenna_attenuation
from .polarization import RECEIVER_MODEL,prepare_polarization,template_orientation,validate_receiver_templates
from ..cell_assignments import cell_eirp,transmitter_rat,power_sum,CELL_RADIO_FIELDS,validate_cell_power_change
from ..radio_scenarios import validate_radio_template
from .model_versions import LEGACY_UMA as MODEL,DIRECTIONAL_UMA as DIRECTIONAL_MODEL,ARRAY_UMA,CELL_UMA,PATTERN_UMA,RECEIVER_UMA

def model_for(snapshot):
    model=snapshot.get('predictionModel',MODEL)
    if model not in (MODEL,DIRECTIONAL_MODEL,ARRAY_UMA,CELL_UMA,PATTERN_UMA,RECEIVER_UMA):raise ValueError('The frozen prediction model is unavailable; it cannot be reinterpreted as a different model.')
    if bool(snapshot.get('radioScenario'))!=(model in (DIRECTIONAL_MODEL,ARRAY_UMA,CELL_UMA,PATTERN_UMA,RECEIVER_UMA)):raise ValueError('The frozen model and scenario inputs do not match.')
    templates=[p['template'] for t in snapshot['transmitters']+snapshot.get('baselineTransmitters',[]) for p in t.get('ports',[{'template':t.get('template',{})}])]
    has_patterns=any(t.get('pattern')=='sampled' for t in templates)
    if model not in (PATTERN_UMA,RECEIVER_UMA) and has_patterns:raise ValueError('Imported sampled grids require the source-pattern prediction model')
    if (model==PATTERN_UMA or model==RECEIVER_UMA and has_patterns) and (not snapshot.get('patternModels') or not snapshot.get('patternAssumptions')):raise ValueError('Frozen source-pattern qualification or assumptions are missing')
    if model not in (CELL_UMA,PATTERN_UMA,RECEIVER_UMA) and any('ports' in t for t in snapshot['transmitters']+snapshot.get('baselineTransmitters',[])):raise ValueError('Source-cell port inputs require the source-cell prediction model')
    has_receiver=any(snapshot.get(k,{}).get('payload',{}).get('receiver') is not None for k in ('radioScenario','radioBaseline'))
    if model!=RECEIVER_UMA and (has_receiver or snapshot.get('receiverAssumptions') or any('polarization' in t for t in templates)):raise ValueError('Receiver and polarization inputs require their matching prediction model')
    if model==RECEIVER_UMA and snapshot.get('receiverAssumptions',{}).get('model')!=RECEIVER_MODEL:raise ValueError('Frozen receiver assumptions are missing or unavailable')
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


def simulate(snapshot, case, powers, *, interval_s, rat, mode, time_origin, cancelled,pattern_assets=None):
    rows = []
    model=model_for(snapshot);directional=model in (DIRECTIONAL_MODEL,ARRAY_UMA)
    if model in (CELL_UMA,PATTERN_UMA,RECEIVER_UMA):
        if (model==PATTERN_UMA or snapshot.get('patternAssumptions')) and pattern_assets is None:
            from .pattern_context import prepare_snapshot_patterns
            pattern_assets=prepare_snapshot_patterns(snapshot)
        receiver=None;polarizations=None
        if model==RECEIVER_UMA:
            templates=[p['template'] for t in snapshot['transmitters'] for p in t.get('ports',[{'template':t.get('template')}])]
            receiver=validate_receiver_templates(snapshot['radioScenario'].get('payload',{}).get('receiver'),templates)
            if receiver:polarizations={id(t):prepare_polarization(template_orientation(t)) for t in templates}
        return simulate_cells(snapshot,case,powers,interval_s=interval_s,rat=rat,time_origin=time_origin,cancelled=cancelled,pattern_assets=pattern_assets,receiver_model=receiver,polarizations=polarizations)
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


def validate_frozen_cell_inputs(snapshot):
    transmitters=snapshot['transmitters']
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
    if snapshot.get('predictionModel')==RECEIVER_UMA:
        templates=[p['template'] for t in transmitters for p in t.get('ports',[{'template':t.get('template')}])]
        payload=snapshot['radioScenario'].get('payload',{})
        if 'receiver' in payload and payload['receiver'] is None:raise ValueError('A declared frozen receiver must be explicit')
        validate_receiver_templates(payload.get('receiver'),templates)


def cell_prediction(transmitter,coordinates,effective_eirp,*,pattern_assets=None,receiver_model=None,polarizations=None):
    separation=distance(coordinates,transmitter['coordinates']);bearing=initial_bearing(transmitter['coordinates'],coordinates)
    elevation=math.degrees(math.atan2(-23.5,separation));delta=effective_eirp-cell_eirp(transmitter);port_values=[]
    common=dict(distanceM=separation,bearingDeg=bearing,elevationDeg=elevation,zeroCollectedPower=False)
    for port in transmitter.get('ports',[{'template':transmitter.get('template')}]):
        template=port['template'];loss=path_loss(separation,template['frequencyMHz'],template['mode'])
        if loss is None:return dict(common,status='model-domain',rxDbm=None,blockedPathId=port.get('linkId'))
        if math.hypot(separation,23.5)<far_field_distance(template,pattern_assets):
            return dict(common,status='near-field',rxDbm=None,blockedPathId=port.get('linkId'))
        if receiver_model:
            fraction=receiver_model.coupling(polarizations[id(template)],bearing,elevation)['powerFraction']
            if fraction:
                port_values.append(peak_eirp(template)+delta-loss-receiver_antenna_attenuation(template,bearing-template['azimuthDeg'],elevation,pattern_assets)+10*math.log10(fraction))
        else:port_values.append(peak_eirp(template)+delta-loss-antenna_attenuation(template,bearing-template['azimuthDeg'],elevation,pattern_assets))
    if receiver_model and not port_values:return {**common,'status':'below-output','rxDbm':None,'zeroCollectedPower':True}
    received=power_sum(port_values)
    return dict(common,status='below-output' if received < -300 else 'supported',rxDbm=None if received < -300 else received)


def simulate_cells(snapshot,case,powers,*,interval_s,rat,time_origin,cancelled,pattern_assets=None,receiver_model=None,polarizations=None):
    transmitters=snapshot['transmitters'];rows=[]
    validate_frozen_cell_inputs(snapshot)
    transmitters=[t for t in transmitters if transmitter_rat(t)==rat]
    if not transmitters:raise ValueError(f'The frozen scenario has no {rat} transmitters.')
    for index,position in enumerate(trajectory(snapshot['route'],case['speedKmh'],interval_s,time_origin)):
        if index%100==0 and cancelled():raise InterruptedError('Experiment cancelled.')
        receiver=[position['longitude'],position['latitude']];candidates=[];near_field=False;below_output=False
        for transmitter in transmitters:
            value=cell_prediction(transmitter,receiver,powers[transmitter['id']],pattern_assets=pattern_assets,receiver_model=receiver_model,polarizations=polarizations)
            near_field|=value['status']=='near-field';below_output|=value['status']=='below-output'
            if value['status']=='supported':candidates.append((value['rxDbm'],transmitter['id']))
        row=dict(**position,rat=rat,leg_id=snapshot['route']['id'])
        if candidates:
            received,identity=max(candidates);row.update(predicted_rx_dbm=received,cell_id='PLAN:'+identity)
        else:row['event']=('Below supported planning-power output range (-300 dBm)' if below_output else 'No complete cell prediction meets all port far-field boundaries' if near_field else 'Outside supported model distance or frequency range')
        rows.append(row)
    return rows
