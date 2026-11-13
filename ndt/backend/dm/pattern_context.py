"""Resolve source grids from the frozen original file, once before publishing members."""
import hashlib
import json
import math
from ..equipment_inventory import COLLECTIONS,trace_cell,validate_inventory
from ..pattern_studies import pattern_summaries,qualify_grid,prepared_pattern
from ..radio_templates import validate_radio_template


def pattern_rows(equipment,transmitters):
    used={p['template']['sampled']['patternId'] for t in transmitters for p in t.get('ports',[]) if p['template']['pattern']=='sampled'}
    if not used:return []
    if not equipment:raise ValueError('Imported patterns require frozen equipment source data')
    rows=equipment.get('patternModels')
    if rows is None:rows=pattern_summaries(equipment['data'],source_sha=equipment['sha256'])
    selected=[dict(row,equipmentRevision=equipment['revision'],equipmentSha256=equipment['sha256']) for row in rows if row['patternId'] in used]
    if {row['patternId'] for row in selected}!=used:raise ValueError('A selected source pattern model is unavailable')
    return sorted(selected,key=lambda row:row['patternId'])


def _same(actual,expected):
    if isinstance(expected,dict):return isinstance(actual,dict) and set(actual)==set(expected) and all(_same(actual[k],v) for k,v in expected.items())
    if isinstance(expected,list):return isinstance(actual,list) and len(actual)==len(expected) and all(_same(a,b) for a,b in zip(actual,expected))
    if type(expected) is bool:return type(actual) is bool and actual==expected
    if isinstance(expected,(int,float)):return type(actual) in (int,float) and -1e308<=actual<=1e308 and math.isfinite(actual) and math.isclose(actual,expected,rel_tol=1e-10,abs_tol=1e-10)
    return type(actual) is type(expected) and actual==expected


def prepare_snapshot_patterns(snapshot):
    equipment=snapshot.get('inventorySnapshot',{}).get('operatorEquipment');rows=snapshot.get('patternModels')
    if not equipment or not isinstance(rows,list) or not rows:raise ValueError('The source-pattern model needs frozen original equipment and pattern qualification')
    raw=equipment.get('raw')
    if not isinstance(raw,str) or hashlib.sha256(raw.encode('utf8')).hexdigest()!=equipment.get('sha256'):raise ValueError('Frozen source-pattern equipment hash does not match its original bytes')
    data=json.loads(raw.removeprefix('\ufeff'));validate_inventory(data,{s['inventorySiteId'] for s in data.get('sites',[])})
    if data['schemaVersion']!=2:raise ValueError('Frozen patterns require equipment schemaVersion 2')
    inventory=dict(equipment,data=data);summaries={r['patternId']:dict(r,equipmentRevision=equipment['revision'],equipmentSha256=equipment['sha256']) for r in pattern_summaries(data,source_sha=equipment['sha256'])}
    ids=[r.get('patternId') for r in rows if isinstance(r,dict)]
    if len(ids)!=len(rows) or len(set(ids))!=len(ids) or any(not _same(r,summaries.get(r['patternId'])) for r in rows):raise ValueError('Frozen pattern qualification does not match the original source model')
    tables={kind:{row['id']:row for row in data[kind]} for kind in COLLECTIONS};traces={};cache={};assets={}
    # Rows may include the other comparison member's model, retained as common provenance.
    for identity in ids:
        assets[identity]=prepared_pattern(tables['patterns'][identity],equipment['sha256'],cache)
    for transmitter in snapshot['transmitters']+snapshot.get('baselineTransmitters',[]):
        for port in transmitter.get('ports',[]):
            template=port['template']
            if template['pattern']!='sampled':continue
            validate_radio_template({k:v for k,v in template.items() if k!='carrier'})
            ref=template['equipmentSource'];cell_id=ref['cellId']
            try:
                if cell_id not in traces:traces[cell_id]=trace_cell(data,cell_id,tables=tables)
                trace=traces[cell_id];connection=next(c for c in trace['connections'] if c['link']['id']==ref['linkId'])
                if transmitter.get('cellId')!=cell_id or transmitter['site_id']!=trace['site']['inventorySiteId'] or transmitter['rat']!=trace['cell']['rat']:raise ValueError('Frozen pattern source cell/site/RAT mismatch')
                checks=dict(linkId=connection['link']['id'],radioId=trace['radio']['id'],radioPortId=connection['radioPort']['id'],antennaPortId=connection['antennaPort']['id'],antennaId=connection['antenna']['id'])
                if any(port.get(k)!=v for k,v in checks.items()):raise ValueError('Frozen pattern physical port path does not match its source')
                if template['sampled']['patternId'] not in assets:raise ValueError('Frozen source pattern is missing its qualification')
                qualify_grid(inventory,dict(trace=trace,connection=connection),template,cache=cache)
            except (KeyError,StopIteration,TypeError) as error:raise ValueError('Frozen pattern path is unavailable in its original source') from error
    return assets
