"""Bounded immutable inputs and cancellable field-calibration diagnostics."""
from collections import Counter
from copy import deepcopy
import math
from .field_calibration import fit_holdout
from .field_measurements import inspect_measurements
from .field_prediction import prepare_field_predictor
from .integration import digest,distance,match_route,route_lengths
from .simulation import simulate
from ..cell_assignments import MAX_PORT_EVALUATIONS,transmitter_rat

SCHEMA='ndt.field-study.v1'
OPTION_KEYS={'cutoffT','heldoutSites','timeGapMs','direction','toleranceM','gapMs','minimumCompatiblePct'}

def _number(value,low,high,label,integer=False):
    if type(value) not in (int,float) or not low<=value<=high or not math.isfinite(value) or integer and int(value)!=value:
        raise ValueError(f'{label} must be a finite {"integer" if integer else "number"} from {low} to {high}')
    return value

def _validate_options(options):
    if not isinstance(options,dict) or set(options)!=OPTION_KEYS:raise ValueError('Provide the current field-study split and quality options')
    for key,low,high,integer in [('cutoffT',-9007199254740991,9007199254740991,True),('timeGapMs',0,86400000,True),
            ('toleranceM',1,200,False),('gapMs',1,3600000,True),('minimumCompatiblePct',1,100,False)]:
        _number(options[key],low,high,key,integer)
    sites=options['heldoutSites']
    if not isinstance(sites,list) or not 1<=len(sites)<=1000 or any(not isinstance(s,str) or not 1<=len(s)<=200 or any(ord(c)<32 for c in s) for s in sites) or len(set(sites))!=len(sites):
        raise ValueError('Choose distinct physical holdout site IDs')
    if options['direction'] not in ('forward','reverse'):raise ValueError('Choose forward or reverse route direction')

def _work(capture,prediction):
    context=prediction.get('context') or {};rows=capture.get('rows',[]);source=prediction.get('rows',[])
    route=context.get('route',{}).get('coordinates',[]);transmitters=context.get('transmitters',[])
    # Bound route matching before doing an equipment trace, hashing or replay.
    if not rows or not source or len(rows)>100000 or len(source)>100000 or len(route)<2:raise ValueError('Field studies need 1–100000 observations per input and a frozen route')
    matching=len(rows)*(len(route)-1)
    ports=sum(len(t.get('ports',[])) or 1 for t in transmitters)
    replay=len(source)*sum(len(t.get('ports',[])) or 1 for t in transmitters if transmitter_rat(t)==context.get('rat'))
    observed=len(rows)*max((len(t.get('ports',[])) or 1 for t in transmitters),default=0)
    if max(matching,replay,observed)>MAX_PORT_EVALUATIONS:raise ValueError('Field study exceeds the modeled work limit; use fewer observations, route segments or assigned ports')
    if not ports:raise ValueError('The frozen run has no assigned source cells')
    return dict(routeEvaluations=matching,replayPortEvaluations=replay,observedPortEvaluations=observed)

def prepare_study(capture,prediction,descriptor_raw,options):
    """Validate and freeze inputs without running route/propagation work."""
    _validate_options(options);work=_work(capture,prediction)
    compatibility=inspect_measurements(capture,prediction,descriptor_raw)
    if not compatibility['ready']:raise ValueError('; '.join(i['message'] for i in compatibility['issues']))
    context=prediction['context']
    if digest(dict(manifest=context,rows=prediction['rows']))!=prediction['sha256']:raise ValueError('Frozen prediction hash does not match its manifest and observations')
    if digest(context['route']['coordinates'])!=context['geometry_hash']:raise ValueError('Frozen route geometry hash does not match its coordinates')
    if not capture['start']<options['cutoffT']<capture['end']:raise ValueError('Choose a UTC cutoff inside the actual capture period')
    sites={m['siteId'] for m in compatibility['mappings']}
    if not set(options['heldoutSites'])<=sites:raise ValueError('Holdout sites must be physical sites in the declared cell mappings')
    physical={t['site_id']:t['coordinates'] for t in context['transmitters'] if t['site_id'] in sites}
    heldout=set(options['heldoutSites'])
    if any(distance(a,b)<=1 for i,a in physical.items() if i in heldout for j,b in physical.items() if j not in heldout):
        raise ValueError('Co-located frozen sites must use the same split; shared coordinates cannot provide an independent holdout')
    case=context.get('case') or {}
    _number(case.get('speedKmh'),.1,500,'Frozen speed');_number(context.get('interval_s'),.1,10,'Frozen sample interval')
    _number(context.get('time_origin'),-9007199254740991,9007199254740991,'Frozen time origin',True)
    expected=math.ceil(route_lengths(context['route']['coordinates'])[-1]/(case['speedKmh']/3.6)/context['interval_s'])+1
    if expected!=len(prediction['rows']):raise ValueError('Frozen replay grid does not match the declared route, speed and sample interval')
    def freeze(test):
        return deepcopy({k:test[k] for k in ('id','label','kind','sha256','scope','start','end','rows','context','source','notes','created') if k in test})
    snapshot=dict(schema=SCHEMA,capture=freeze(capture),prediction=freeze(prediction),descriptorRaw=descriptor_raw,
        compatibility=compatibility,options=deepcopy(options),work=work)
    snapshot['inputSha256']=digest(snapshot)
    return snapshot

def _replay(snapshot,prepared,cancelled):
    prediction=snapshot['prediction'];context=prediction['context']
    actual=simulate(context,context['case'],context['powers'],interval_s=context['interval_s'],rat=context['rat'],mode=context['mode'],
        time_origin=context['time_origin'],cancelled=cancelled,pattern_assets=prepared.assets)
    expected=prediction['rows'];maximum=0.0
    if len(actual)!=len(expected):raise ValueError('Frozen numerical replay row count differs from its saved source')
    for index,(a,b) in enumerate(zip(actual,expected)):
        if index%100==0 and cancelled():raise InterruptedError('Frozen replay cancelled.')
        if set(a)!=set(b):raise ValueError(f'Frozen numerical replay fields differ at observation {index+1}')
        for key,value in a.items():
            other=b[key]
            if type(value) in (int,float) and type(other) in (int,float):
                error=abs(value-other);maximum=max(maximum,error)
                # Timestamp, identity and grid geometry must remain exact.
                tolerance=1e-7 if key in ('predicted_rx_dbm','chainage_m') else 0
                if not math.isfinite(other) or error>tolerance:raise ValueError(f'Frozen numerical replay differs at observation {index+1} ({key})')
            elif type(value)!=type(other) or value!=other:raise ValueError(f'Frozen numerical replay differs at observation {index+1} ({key})')
    return dict(rows=len(actual),maxAbsoluteError=maximum,tolerance=1e-7,sourceSha256=prediction['sha256'])

def run_study(snapshot,*,cancelled=lambda:False,progress=lambda n:None):
    """Return diagnostics only. Never mutate a run, model, template or capture."""
    if snapshot.get('schema')!=SCHEMA or digest({k:v for k,v in snapshot.items() if k!='inputSha256'})!=snapshot.get('inputSha256'):
        raise ValueError('Frozen field-study input hash does not match its snapshot')
    if cancelled():raise InterruptedError('Field study cancelled.')
    progress(0);capture=snapshot['capture'];context=snapshot['prediction']['context'];options=snapshot['options']
    prepared=prepare_field_predictor(context);replay=_replay(snapshot,prepared,cancelled);progress(25)
    association=match_route(capture['rows'],context['route'],direction=options['direction'],tolerance_m=options['toleranceM'],gap_ms=options['gapMs'],
        cancelled=cancelled,progress=lambda n:progress(25+n//4))
    mappings={(m['rat'],m['captureCellId']):m for m in snapshot['compatibility']['mappings']}
    instrument=snapshot['compatibility']['descriptor']['instrument'];observations=[];pairs=[];reasons=Counter()
    for index,(row,match) in enumerate(zip(capture['rows'],association['samples'])):
        if index%100==0:
            if cancelled():raise InterruptedError('Observed-cell prediction cancelled.')
            progress(50+45*index//len(capture['rows']))
        item=dict(index=index,t=row['t'],rat=row['rat'],captureCellId=row.get('cell_id'),measurementStatus=row.get('measurement_status'),
            measuredDbm=row.get('measured_rx_dbm'),longitude=row.get('longitude'),latitude=row.get('latitude'),
            chainageM=match.get('chainage_m'),lateralErrorM=match.get('lateral_error_m'))
        mapping=mappings.get((row['rat'],row.get('cell_id')));reason=None;power=row.get('measured_rx_dbm');quality=row.get('measurement_status')
        if quality not in ('valid','below-floor','above-ceiling','invalid'):reason='missing-quality'
        elif quality!='valid':reason=quality
        elif type(power) not in (int,float) or not math.isfinite(power):reason='missing-power'
        elif not instrument['minimumDbm']<=power<=instrument['maximumDbm']:reason='outside-instrument-range'
        elif not mapping:reason='unmapped-cell'
        elif 'band' not in row or 'arfcn' not in row:reason='missing-carrier'
        elif row['band']!=mapping['band'] or row['arfcn']!=mapping['arfcn']:reason='carrier-mismatch'
        elif match['status']!='matched':reason=match['status']
        if mapping:item.update(siteId=mapping['siteId'],cellId=mapping['transmitterId'])
        if reason is None:
            prediction=prepared.at(mapping['transmitterId'],[row['longitude'],row['latitude']]);item['prediction']=prediction
            if prediction['status']!='supported':reason='zero-receiver-collection' if prediction['zeroCollectedPower'] else prediction['status']
            else:
                item.update(predictedDbm=prediction['rxDbm'],residualDb=power-prediction['rxDbm'],eligibleIndex=len(pairs))
                pairs.append(dict(siteId=mapping['siteId'],cellId=mapping['transmitterId'],t=row['t'],chainageM=match['chainage_m'],
                    **{k:mapping[k] for k in ('rat','band','frequencyMHz','bandwidthMHz','environment')},measuredDbm=power,predictedDbm=prediction['rxDbm']))
        item['reason']=reason;item['status']='excluded' if reason else 'eligible';observations.append(item)
        if reason:reasons[reason]+=1
    if cancelled():raise InterruptedError('Field calibration cancelled.')
    progress(95)
    compatible_pct=100*len(pairs)/len(observations)
    calibration=fit_holdout(pairs,cutoff_t=options['cutoffT'],heldout_sites=options['heldoutSites'],gap_ms=options['timeGapMs'])
    # Retain bin/quarantine diagnostics but withhold the candidate on poor data coverage.
    if compatible_pct<options['minimumCompatiblePct']:
        calibration['status']='insufficient-compatible-data'
        calibration['offsetDb']=None
        calibration['holdout']['adjusted']=None
        for b in calibration['bins']:b['adjustedResidualDb']=None
        for key in ('byCarrier','byEnvironment','bySite'):
            for group in calibration[key]:group.update(adjusted=None,pairedRaw=None,unscoredBins=group['bins'])
        status='insufficient-compatible-data'
    else:status=calibration['status']
    eligible_to_observation=[i for i,item in enumerate(observations) if item['status']=='eligible']
    for b in calibration['bins']:
        b['observationIndices']=[eligible_to_observation[i] for i in b['indices']]
        del b['indices']
    result=dict(schema=SCHEMA,status=status,inputSha256=snapshot['inputSha256'],independentlyVerified=False,replay=replay,
        quality=dict(total=len(observations),eligible=len(pairs),excluded=sum(reasons.values()),compatiblePct=compatible_pct,
            minimumCompatiblePct=options['minimumCompatiblePct'],reasons=dict(reasons)),
        route={k:v for k,v in association.items() if k!='samples'},calibration=calibration,observations=observations,
        limitations=snapshot['compatibility']['assumptions']+' '+calibration['limitations']+
            ' The imported CSV is identified by its original hash; only its normalized observations are retained, not the original CSV bytes.')
    progress(100)
    return result
