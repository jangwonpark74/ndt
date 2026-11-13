"""Explicit source-cell paths and conducted-power constraints, separate from licensing."""
from copy import deepcopy
import math
import re

from .radio_templates import validate_radio_template
from .carrier_plan import validate_carrier
from .equipment_studies import resolve_equipment_paths
from .dm.antenna import peak_eirp

MAX_CELLS=1000
MAX_PORTS=4096
MAX_PORT_EVALUATIONS=20000000
CELL_RADIO_FIELDS=('rat','frequencyMHz','bandwidthMHz','carrier','mode')


def power_sum(values):
    values=list(values)
    if not values:return None
    maximum=max(values)
    return maximum+10*math.log10(math.fsum(10**((value-maximum)/10) for value in values))


def cell_eirp(transmitter):
    return power_sum(peak_eirp(port['template']) for port in transmitter['ports']) if 'ports' in transmitter else peak_eirp(transmitter['template'])


def transmitter_rat(transmitter):
    return transmitter['rat'] if 'ports' in transmitter else transmitter['template']['rat']


def _check_budgets(powers,budgets,*,qualified=False):
    if not isinstance(budgets,dict) or set(budgets)!=set(powers):raise ValueError('Provide one modeled radio budget (or explicit unknown) for every assigned radio')
    totals={radio:power_sum(values) for radio,values in powers.items()}
    for radio,value in budgets.items():
        if value is None:
            if qualified:raise ValueError(f'Radio {radio}: enter a modeled conducted-power budget before execution')
            continue
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not -30<=value<=80 or not math.isfinite(value):raise ValueError(f'Radio {radio}: budget must be -30 to 80 dBm or explicit unknown')
        if totals[radio]>value+1e-9:raise ValueError(f'Radio {radio}: allocated {totals[radio]:.3f} dBm exceeds its {value:g} dBm modeled budget')
    return totals


def resolve_cell_assignments(db,region,project,cells,budgets,*,current=False,qualified=False,cache=None):
    if not isinstance(cells,list) or len(cells)>MAX_CELLS:raise ValueError(f'Provide at most {MAX_CELLS} source cells')
    if qualified and not cells:raise ValueError('Assign at least one imported cell and its ports')
    references=[];ids=set();count=0
    for cell in cells:
        if not isinstance(cell,dict) or set(cell)!={'cellId','ports'} or not isinstance(cell['cellId'],str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',cell['cellId']):raise ValueError('Each assigned cell needs a source cell ID and port templates')
        if cell['cellId'] in ids:raise ValueError('An imported cell can be assigned only once')
        ids.add(cell['cellId'])
        if not isinstance(cell['ports'],list) or not 1<=len(cell['ports'])<=64:raise ValueError('Each cell needs 1 to 64 explicit source port paths')
        count+=len(cell['ports'])
        if count>MAX_PORTS:raise ValueError(f'Provide at most {MAX_PORTS} assigned port paths')
        common=None
        for template in cell['ports']:
            validate_radio_template(template)
            reference=template.get('equipmentSource')
            if not reference or reference['cellId']!=cell['cellId']:raise ValueError('Every port template must identify the assigned source cell and link')
            radio_values=[template.get(field) for field in CELL_RADIO_FIELDS]
            if common is not None and common!=radio_values:raise ValueError('All ports of a cell must share RAT, carrier, bandwidth and environment')
            common=radio_values;references.append(reference)
            if qualified:validate_carrier(template,required=True)
    paths,inventory=resolve_equipment_paths(db,region,project,references,current=current,cache=cache)
    result=[];power_allocations={};occupied={};radio_endpoints={};antenna_endpoints={};index=0
    for assignment in cells:
        resolved=[];radio_ports=set();antenna_ports=set();trace=None
        for template in assignment['ports']:
            path=paths[index];index+=1;trace=path['trace'];connection=path['connection']
            if template['rat']!=trace['cell']['rat']:raise ValueError('Assigned RAT must match the imported cell RAT')
            rp=connection['radioPort']['id'];ap=connection['antennaPort']['id'];radio=trace['radio']['id']
            if rp in radio_ports or ap in antenna_ports:raise ValueError('A cell cannot count the same physical TX or antenna port twice')
            radio_ports.add(rp);antenna_ports.add(ap)
            if (rp in radio_endpoints and radio_endpoints[rp]!=ap) or (ap in antenna_endpoints and antenna_endpoints[ap]!=rp):raise ValueError('Assigned links require one-to-one physical endpoints; splitter/combiner networks are unsupported')
            radio_endpoints[rp]=ap;antenna_endpoints[ap]=rp
            low=template['frequencyMHz']-template['bandwidthMHz']/2;high=template['frequencyMHz']+template['bandwidthMHz']/2
            if any(max(low,a)<min(high,b)-1e-9 for a,b in occupied.get(rp,[])):raise ValueError(f'Radio port {rp}: overlapping cell carriers require an unsupported sharing model')
            occupied.setdefault(rp,[]).append((low,high));power_allocations.setdefault(radio,[]).append(template['powerDbm'])
            resolved.append(dict(linkId=connection['link']['id'],radioId=radio,radioPortId=rp,antennaPortId=ap,antennaId=connection['antenna']['id'],radioPortName=connection['radioPort'].get('name') or rp,antennaPortName=connection['antennaPort'].get('name') or ap,template=deepcopy(template)))
        result.append(dict(cell=trace['cell'],site=trace['site'],sector=trace['sector'],ports=resolved))
    return dict(cells=result,inventory=inventory,radioPowerDbm=_check_budgets(power_allocations,budgets,qualified=qualified))


def build_cell_transmitters(resolved,features):
    by_id={}
    for feature in features:
        properties=feature['properties'];identity=properties.get('site_id',properties.get('id'))
        if identity is None:raise ValueError('A contributing regional site has no inventory identity')
        identity=str(identity)
        if identity in by_id and by_id[identity]['geometry']['coordinates']!=feature['geometry']['coordinates']:raise ValueError(f'Ambiguous regional coordinates for site {identity}')
        by_id[identity]=feature
    result=[]
    for item in resolved['cells']:
        site_id=item['site']['inventorySiteId'];feature=by_id.get(site_id)
        if feature is None:raise ValueError(f'Assigned source site {site_id} is unavailable in the current regional inventory')
        cell=item['cell'];template=item['ports'][0]['template'];properties=feature['properties']
        label=item['site'].get('name') or f"{properties.get('provider') or properties.get('franchisee') or 'Site'} {next(iter(properties.get('ised_site_ids') or []),site_id)}"
        identity=cell.get('cellIdentity') or cell['id']
        transmitter=dict(id='CELL:'+cell['id'],site_id=site_id,label=f'{label} / {identity}',cellId=cell['id'],cellIdentity=identity,rat=cell['rat'],coordinates=feature['geometry']['coordinates'][:2],frequency_mhz=template['frequencyMHz'],ports=deepcopy(item['ports']))
        bound=cell_eirp(transmitter)
        if not 0<=bound<=90:raise ValueError(f'Cell {identity}: virtual drives support summed EIRP upper bounds from 0 to 90 dBm')
        result.append(transmitter)
    return result


def validate_cell_power_change(transmitters,budgets,target_id=None,changed_eirp=None):
    if target_id is not None and (isinstance(changed_eirp,bool) or not isinstance(changed_eirp,(int,float)) or not 0<=changed_eirp<=90):raise ValueError('Changed cell EIRP upper bound must be 0 to 90 dBm')
    powers={};found=target_id is None
    for transmitter in transmitters:
        if 'ports' not in transmitter:continue
        delta=changed_eirp-cell_eirp(transmitter) if transmitter['id']==target_id else 0
        found|=transmitter['id']==target_id
        for port in transmitter['ports']:
            value=port['template']['powerDbm']+delta
            if not -30<=value<=80:raise ValueError('Changed cell power exceeds the supported per-port conducted-power range')
            powers.setdefault(port['radioId'],[]).append(value)
    if not found:raise ValueError('Select an assigned source cell for the power change')
    _check_budgets(powers,budgets,qualified=True)
