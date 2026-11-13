"""Inspect declared measurement compatibility without certifying source claims."""
from copy import deepcopy
from datetime import datetime
import hashlib,json,math,re
from .dm_model import ISO,EPOCH
from .simulation import model_for,validate_frozen_cell_inputs
from .model_versions import CELL_UMA,PATTERN_UMA,RECEIVER_UMA
from .polarization import prepare_receiver,ORIENTATION_BOUNDS
from ..equipment_inventory import trace_cell,validate_inventory
from ..cell_assignments import validate_cell_power_change

SCHEMA='ndt.field-measurement.v1'
SCALAR_RECEIVER={'model':'ndt.receiver.scalar-ideal.v1'}
MAX_DESCRIPTOR_BYTES=128*1024
ROOT={'schema','captureSha256','predictionSha256','equipmentSha256','geometryHash','provenance','instrument','measurement','configuration','cells'}

def _keys(value,keys,label):
    if not isinstance(value,dict) or set(value)!=set(keys):raise ValueError(f'{label} has missing or unsupported fields; use the current measurement template')

def _text(value,label,maximum=200):
    if not isinstance(value,str) or len(value)>maximum or any(ord(c)<32 for c in value):raise ValueError(f'{label} must be plain text of at most {maximum} characters')
    return value

def _number(value,low,high,label,integer=False):
    if value is None:return None
    if type(value) not in (int,float) or not low<=value<=high or not math.isfinite(value) or integer and int(value)!=value:
        raise ValueError(f'{label} must be a finite {"integer" if integer else "number"} from {low} to {high}')
    return value

def utc_millis(value,label):
    _text(value,label,80)
    if value=='':return None
    if not ISO.fullmatch(value):raise ValueError(f'{label} needs ISO 8601 with a UTC offset and at most milliseconds')
    try:elapsed=datetime.fromisoformat(value.replace('Z','+00:00'))-EPOCH
    except (ValueError,OverflowError) as error:raise ValueError(f'{label} is not a valid UTC-offset date') from error
    return (elapsed.days*86400+elapsed.seconds)*1000+elapsed.microseconds//1000

def _unique_object(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ValueError(f'Duplicate descriptor field: {key}')
        result[key]=value
    return result

def _finite_constant(value):raise ValueError('Descriptor JSON must use finite values')

def parse_descriptor(raw):
    if not isinstance(raw,str) or not 0<len(raw.encode('utf8'))<=MAX_DESCRIPTOR_BYTES:raise ValueError('Measurement descriptor must be 1 byte to 128 KiB of UTF-8 JSON')
    try:value=json.loads(raw.removeprefix('\ufeff'),object_pairs_hook=_unique_object,parse_constant=_finite_constant)
    except (json.JSONDecodeError,UnicodeError) as error:raise ValueError('Measurement descriptor is not valid UTF-8 JSON') from error
    _keys(value,ROOT,'Measurement descriptor')
    if value['schema']!=SCHEMA:raise ValueError('Unsupported measurement descriptor version')
    for key in ['captureSha256','predictionSha256','equipmentSha256','geometryHash']:
        if not isinstance(value[key],str) or value[key] and not re.fullmatch('[a-f0-9]{64}',value[key]):raise ValueError(f'{key} needs a lowercase SHA-256 value')
    provenance=value['provenance'];_keys(provenance,{'origin','recordId','uri'},'Measurement provenance')
    for key in provenance:_text(provenance[key],key,2048 if key=='uri' else 200)
    instrument=value['instrument'];_keys(instrument,{'id','calibrationRecordId','calibratedAt','validUntil','minimumDbm','maximumDbm'},'Instrument')
    for key in ['id','calibrationRecordId']:_text(instrument[key],key)
    for key in ['calibratedAt','validUntil']:utc_millis(instrument[key],key)
    for key in ['minimumDbm','maximumDbm']:_number(instrument[key],-300,90,key)
    if instrument['minimumDbm'] is not None and instrument['maximumDbm'] is not None and instrument['minimumDbm']>=instrument['maximumDbm']:
        raise ValueError('Instrument minimum must be below its maximum')
    measurement=value['measurement'];_keys(measurement,{'quantity','column','unit','referencePlane','averaging','averagingWindowM','bsHeightM','ueHeightM','receiver'},'Measurement definition')
    for key in ['quantity','column','unit','referencePlane','averaging']:_text(measurement[key],key)
    _number(measurement['averagingWindowM'],.01,1000,'Averaging window')
    _number(measurement['bsHeightM'],.1,1000,'BS height');_number(measurement['ueHeightM'],.1,1000,'UE height')
    if measurement['receiver'] is not None and not isinstance(measurement['receiver'],dict):raise ValueError('Receiver declaration must be an object')
    config=value['configuration'];_keys(config,{'sourceId','recordId','matched','validFrom','validUntil'},'Configuration attestation')
    for key in ['sourceId','recordId']:_text(config[key],key)
    if type(config['matched']) is not bool:raise ValueError('Explicit configuration matching must be true or false')
    for key in ['validFrom','validUntil']:utc_millis(config[key],key)
    if not isinstance(value['cells'],list) or len(value['cells'])>1000:raise ValueError('Map at most 1000 observed cells')
    observed=set();targets=set()
    for row in value['cells']:
        _keys(row,{'captureCellId','transmitterId','rat','band','arfcn','frequencyMHz','bandwidthMHz'},'Cell mapping')
        for key in ['captureCellId','transmitterId','band']:
            if not _text(row[key],key):raise ValueError(f'{key} must not be blank')
        if row['rat'] not in ('LTE','NR'):raise ValueError('Mapped RAT must be LTE or NR')
        for key,low,high,integer in [('arfcn',0,3279165,True),('frequencyMHz',500,100000,False),('bandwidthMHz',.1,400,False)]:
            if _number(row[key],low,high,key,integer) is None:raise ValueError(f'{key} is required')
        identity=(row['rat'],row['captureCellId'])
        if identity in observed or row['transmitterId'] in targets:raise ValueError('Observed-cell mappings must be one-to-one and unique')
        observed.add(identity);targets.add(row['transmitterId'])
    return value

def _receiver_key(value):
    if value==SCALAR_RECEIVER:return ('available-total-power',)
    prepare_receiver(value)
    if value['collection']=='dual-orthogonal':return ('available-total-power',)
    return ('single-linear',*(value['orientation'][key] for key in ORIENTATION_BOUNDS))

def _equipment(context):
    equipment=context.get('inventorySnapshot',{}).get('operatorEquipment')
    if not isinstance(equipment,dict) or not isinstance(equipment.get('raw'),str):raise ValueError('Original operator equipment is missing from this frozen run')
    if hashlib.sha256(equipment['raw'].encode('utf8')).hexdigest()!=equipment.get('sha256'):raise ValueError('Frozen equipment SHA-256 does not match its original bytes')
    try:data=json.loads(equipment['raw'].removeprefix('\ufeff'))
    except json.JSONDecodeError as error:raise ValueError('Frozen equipment JSON is unreadable') from error
    validate_inventory(data,{s['inventorySiteId'] for s in data.get('sites',[])})
    return equipment,data

def descriptor_template(capture,prediction):
    context=prediction.get('context') or {};equipment=context.get('inventorySnapshot',{}).get('operatorEquipment') or {}
    receiver=deepcopy(context.get('radioScenario',{}).get('payload',{}).get('receiver') or SCALAR_RECEIVER)
    cells=[]
    for transmitter in context.get('transmitters',[]):
        if not transmitter.get('ports'):continue
        template=transmitter['ports'][0]['template'];carrier=template.get('carrier') or {}
        if not carrier:continue
        cells.append(dict(captureCellId=transmitter.get('cellIdentity') or transmitter['cellId'],transmitterId=transmitter['id'],
            rat=template['rat'],band=carrier['band'],arfcn=carrier['channel'],frequencyMHz=template['frequencyMHz'],bandwidthMHz=template['bandwidthMHz']))
    return dict(schema=SCHEMA,captureSha256=capture['sha256'],predictionSha256=prediction['sha256'],equipmentSha256=equipment.get('sha256',''),geometryHash=context.get('geometry_hash',''),
        provenance=dict(origin='unknown',recordId='',uri=''),
        instrument=dict(id='',calibrationRecordId='',calibratedAt='',validUntil='',minimumDbm=None,maximumDbm=None),
        measurement=dict(quantity='desired-carrier-local-mean-power',column='measured_rx_dbm',unit='dBm',referencePlane='ndt.zero-gain-receiver.v1',
            averaging='linear-power-local-mean',averagingWindowM=None,bsHeightM=None,ueHeightM=None,receiver=receiver),
        configuration=dict(sourceId='',recordId='',matched=False,validFrom='',validUntil=''),cells=cells)

def inspect_measurements(capture,prediction,raw):
    descriptor=parse_descriptor(raw);issues=[]
    def issue(code,message):issues.append(dict(code=code,message=message))
    context=prediction.get('context') or {};rows=capture.get('rows') or []
    if capture.get('kind')!='imported':issue('capture-origin','Use an imported operator capture; synthetic and simulated runs cannot provide field evidence')
    if prediction.get('kind')!='simulated':issue('prediction-origin','Choose a frozen source-cell planning run')
    if any(capture.get('scope',{}).get(k)!=prediction.get('scope',{}).get(k) for k in ['region_id','project_id','task_id']):
        issue('scope','Capture and prediction must belong to the same region, project and Task')
    for key,expected,code in [('captureSha256',capture.get('sha256'),'capture-hash'),('predictionSha256',prediction.get('sha256'),'prediction-hash'),('geometryHash',context.get('geometry_hash'),'route')]:
        if not expected or descriptor[key]!=expected:issue(code,'The descriptor does not match the selected '+code.replace('-',' '))
    provenance=descriptor['provenance']
    if provenance['origin']!='operator-measurement' or not provenance['recordId'] or not provenance['uri'].startswith(('https://','http://','urn:')):
        issue('provenance','Declare an operator measurement record and source URI; these remain unverified source claims')
    measurement=descriptor['measurement']
    if (measurement['quantity'],measurement['column'],measurement['unit'])!=('desired-carrier-local-mean-power','measured_rx_dbm','dBm'):
        issue('metric','These models predict desired-carrier mean power, not LTE/NR reference-element RSRP or interference/noise-inclusive RSSI; no conversion is inferred')
    if not any(type(r.get('measured_rx_dbm')) in (int,float) and math.isfinite(r['measured_rx_dbm']) for r in rows):
        issue('metric','The capture has no explicit measured_rx_dbm observations')
    if not any(r.get('measurement_status')=='valid' for r in rows):issue('quality','No observations explicitly declare valid measurement status')
    if not any('latitude' in r and 'longitude' in r for r in rows):issue('gps','Observed GPS is required for field validation')
    if not any('arfcn' in r for r in rows):issue('carrier','Observed carrier channels are required; missing channels are never inferred')
    if measurement['referencePlane']!='ndt.zero-gain-receiver.v1':issue('reference-plane','Declare calibrated power at the same zero-gain receiver reference; instrument/antenna gain is not guessed')
    if measurement['averaging']!='linear-power-local-mean' or measurement['averagingWindowM'] is None:
        issue('averaging','Declare the linear-power local-mean method and spatial averaging window')
    if measurement['bsHeightM']!=25 or measurement['ueHeightM']!=1.5:issue('geometry','The frozen UMa models require the same 25 m BS and 1.5 m UE heights above local ground')
    try:
        expected=context.get('radioScenario',{}).get('payload',{}).get('receiver') or SCALAR_RECEIVER
        if _receiver_key(measurement['receiver'])!=_receiver_key(expected):issue('receiver','Measured receiver collection/orientation does not match the frozen reference')
    except (ValueError,TypeError,KeyError):issue('receiver','Provide a supported receiver collection and its complete orientation')
    instrument=descriptor['instrument'];config=descriptor['configuration']
    if not instrument['id'] or not instrument['calibrationRecordId'] or instrument['minimumDbm'] is None or instrument['maximumDbm'] is None:
        issue('instrument','Identify the receiver, its calibration record and valid power range')
    for value,start,end,code in [(instrument,'calibratedAt','validUntil','instrument-time'),(config,'validFrom','validUntil','configuration-time')]:
        lo=utc_millis(value[start],start);hi=utc_millis(value[end],end)
        if lo is None or hi is None or lo>=hi or not lo<=capture['start']<=capture['end']<hi:
            issue(code,'The declared '+code.split('-')[0]+' validity window must cover the entire actual capture, not the virtual-drive wall clock')
    if not config['matched'] or not config['recordId']:issue('configuration','Explicitly attest the complete frozen transmit, antenna, geometry and receiver assumptions against an identified configuration record')
    equipment=data=None
    try:
        if any(context.get('scope',{}).get(k)!=prediction.get('scope',{}).get(k) for k in ('region_id','project_id','task_id')):
            raise ValueError('Frozen prediction scope does not match its registry Project and Task')
        if model_for(context) not in (CELL_UMA,PATTERN_UMA,RECEIVER_UMA):raise ValueError('Use an explicit source-cell prediction; license-only/site models are not field evidence')
        validate_frozen_cell_inputs(context)
        if not isinstance(context.get('powers'),dict):raise ValueError('Frozen effective powers are missing')
        validate_cell_power_change(context['transmitters'],context['radioScenario']['payload'].get('radioBudgets'),effective_powers=context['powers'])
        equipment,data=_equipment(context)
    except (ValueError,KeyError,TypeError) as error:issue('source-model',str(error))
    if not equipment or descriptor['equipmentSha256']!=equipment.get('sha256'):issue('equipment-hash','The descriptor must pin the original frozen equipment file hash')
    sources={s['id']:s for s in data['sources']} if data else {}
    if config['sourceId'] not in sources or sources[config['sourceId']]['kind']!='operator':issue('configuration-source','Use an operator configuration source retained in the frozen equipment file')
    transmitters={t['id']:t for t in context.get('transmitters',[])};mapped=[]
    if not descriptor['cells']:issue('cell-mapping','Explicit observed-to-frozen cell mappings are required; PCI alone is never used as an identity')
    for mapping in descriptor['cells']:
        transmitter=transmitters.get(mapping['transmitterId'])
        if not transmitter or not transmitter.get('ports'):
            issue('cell-mapping','Mapped cell '+mapping['transmitterId']+' is not an explicit assigned source cell');continue
        template=transmitter['ports'][0]['template'];carrier=template.get('carrier') or {}
        if any(mapping[k]!=v for k,v in dict(rat=template['rat'],band=carrier.get('band'),arfcn=carrier.get('channel'),frequencyMHz=template['frequencyMHz'],bandwidthMHz=template['bandwidthMHz']).items()):
            issue('carrier','Mapped RAT/band/channel/frequency/bandwidth differs from frozen cell '+transmitter['id'])
        if data:
            try:
                trace=trace_cell(data,transmitter['cellId'])
                if sources.get(trace['cell']['sourceId'],{}).get('kind')!='operator':raise ValueError('The mapped cell is not declared operator equipment')
                if trace['site']['inventorySiteId']!=transmitter['site_id']:raise ValueError('Mapped cell site differs from its frozen physical path')
                paths={p['link']['id']:p for p in trace['connections']}
                for port in transmitter['ports']:
                    path=paths.get(port['linkId']);ref=port['template'].get('equipmentSource')
                    if not path or not ref or any(ref.get(k)!=v for k,v in dict(revision=equipment['revision'],sha256=equipment['sha256'],cellId=transmitter['cellId'],linkId=port['linkId']).items()):
                        raise ValueError('Frozen cell/port provenance does not match the original equipment')
                    if port.get('radioId')!=path['radioPort']['equipmentId'] or any(port.get(k)!=path[v]['id'] for k,v in dict(radioPortId='radioPort',antennaPortId='antennaPort',antennaId='antenna').items()):
                        raise ValueError('Frozen physical radio/antenna path does not match the original equipment')
            except (ValueError,KeyError,StopIteration) as error:issue('cell-source',str(error))
        mapped.append(dict(mapping,siteId=transmitter['site_id'],label=transmitter.get('label',transmitter['id']),environment=template['mode']))
    return dict(schema=SCHEMA,ready=not issues,issues=issues,issueCodes=sorted({i['code'] for i in issues}),
        independentlyVerified=False,mappedCells=len(mapped),mappings=mapped,descriptor=descriptor,
        descriptorSha256=hashlib.sha256(raw.encode('utf8')).hexdigest(),
        assumptions='Declared measurement/configuration compatibility only; original source claims and instrumentation are not independently verified. '
        'No RSRP/RSSI conversion, unknown gain correction, strongest-cell substitution or field-accuracy certification.')
