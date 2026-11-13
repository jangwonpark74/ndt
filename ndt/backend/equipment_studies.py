"""Source links identify copied evidence; editable templates still govern RF estimates."""
import re
from .equipment_inventory import read_inventory,trace_cell


def validate_equipment_reference(reference):
    if not isinstance(reference,dict) or set(reference)!={'revision','sha256','cellId','linkId'}:
        raise ValueError('Equipment source needs a revision, hash, cell and link')
    if type(reference['revision']) is not int or not 1<=reference['revision']<=50:
        raise ValueError('Invalid equipment source revision')
    if not isinstance(reference['sha256'],str) or not re.fullmatch(r'[a-f0-9]{64}',reference['sha256']):
        raise ValueError('Invalid equipment source hash')
    if not all(isinstance(reference[key],str) and re.fullmatch(r'[A-Za-z0-9_-]{1,64}',reference[key]) for key in ('cellId','linkId')):
        raise ValueError('Invalid equipment source cell or link ID')


def validate_equipment_templates(db,region,project,template,overrides,*,current=False,cache=None):
    if 'equipmentSource' in template:raise ValueError('Equipment source links require a site override, not a project default template')
    references=[(site,value['equipmentSource']) for site,value in overrides.items() if 'equipmentSource' in value]
    if not references:return
    for _,reference in references:validate_equipment_reference(reference)
    keys={(r['revision'],r['sha256']) for _,r in references}
    if len(keys)!=1:raise ValueError('Source-linked site overrides must use one equipment import revision; re-link or clear older links')
    revision,sha=next(iter(keys))
    if current:
        latest=db.execute('SELECT revision,sha256,source_fingerprint FROM equipment_inventory_versions WHERE region_id=? AND project_id=? ORDER BY revision DESC LIMIT 1',(region,project)).fetchone()
        if not latest or (latest[0],latest[1])!=(revision,sha):raise ValueError('Equipment source changed. Re-link reviewed equipment or keep the study as assumptions.')
        fingerprint=db.execute('SELECT fingerprint FROM regions WHERE id=?',(region,)).fetchone()
        if not fingerprint or latest[2]!=fingerprint[0]:raise ValueError('Equipment source was imported against an older regional inventory. Preview and import the reviewed source again.')
    cache={} if cache is None else cache;key=(region,project,revision)
    if key not in cache:cache[key]=read_inventory(db,region,project,revision)
    inventory=cache[key]
    if not inventory or inventory['sha256']!=sha:raise ValueError('Equipment source revision/hash is unavailable in this project')
    traces={}
    for site,reference in references:
        try:
            cell=reference['cellId']
            if cell not in traces:traces[cell]=trace_cell(inventory['data'],cell)
            trace=traces[cell]
            if trace['site']['inventorySiteId']!=site or not any(c['link']['id']==reference['linkId'] for c in trace['connections']):raise KeyError('path')
        except (KeyError,TypeError):raise ValueError(f'Equipment source needs an explicit cell/radio/port/antenna path at site override {site}') from None
