"""Numerical qualification and explicit equipment-path binding for imported scalar grids."""
import math
import re
import hashlib
import json
from .pattern_models import ScalarGainGrid,GRID_MODEL,finite


def validate_sampled(template):
    if template['pattern']!='sampled':
        if 'sampled' in template:raise ValueError('Sampled model inputs require the imported scalar-grid pattern')
        return
    value=template.get('sampled')
    if not isinstance(value,dict) or set(value)!={'format','patternId','rollDeg'} or value['format']!=GRID_MODEL:raise ValueError('Select a reviewed versioned scalar grid and mechanical roll')
    if not isinstance(value['patternId'],str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',value['patternId']):raise ValueError('Invalid source pattern ID')
    finite(value['rollDeg'],-180,180,'Mechanical roll')
    if not template.get('equipmentSource'):raise ValueError('An imported grid requires an explicit source cell and port path')


def prepared_pattern(pattern,source_sha='',cache=None):
    cache=cache if cache is not None else {}
    key=('scalar-grid',source_sha,pattern['id'])
    if key not in cache:cache[key]=ScalarGainGrid(pattern.get('radiation'))
    return cache[key]


def pattern_summaries(data,*,source_sha='',cache=None):
    if data.get('schemaVersion')!=2:return []
    result=[];sources={s['id']:s for s in data['sources']}
    for pattern in data['patterns']:
        if 'radiation' not in pattern:continue
        g=prepared_pattern(pattern,source_sha,cache);r=pattern['radiation'];source=sources[pattern['sourceId']]
        result.append(dict(patternId=pattern['id'],name=pattern.get('name') or pattern['id'],format=GRID_MODEL,
            antennaModel=r['antennaModel'],portNames=r['portNames'],evidence=r['evidence'],independentlyVerified=False,
            numericalQualification='piecewise-linear-power-passivity-checked-v1',sampleCount=g.sample_count,
            frequencyMHz=list(g.frequency),peakGainDbi=[g.peak_gain_dbi(f) for f in g.frequency],efficiencies=list(g.efficiencies),
            electricalState=r['electricalState'],electricalTiltDeg=r['electricalTiltDeg'],referenceImpedanceOhm=r['referenceImpedanceOhm'],
            portConditions=r['portConditions'],maxDimensionM=r['maxDimensionM'],coordinateSystem=r['coordinateSystem'],referencePlane=r['referencePlane'],
            radiationSha256=hashlib.sha256(json.dumps(r,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf8')).hexdigest(),
            sourceId=source['id'],sourceRecordId=pattern['sourceRecordId'],sourceTitle=source['title'],sourceURI=source['uri'],observedAt=source['observedAt']))
    return result


def qualify_grid(inventory,path,template,*,cache=None):
    validate_sampled(template)
    if inventory['data'].get('schemaVersion')!=2:raise ValueError('Imported scalar-grid execution requires equipment schemaVersion 2')
    ref=template['equipmentSource']
    if ref.get('revision')!=inventory['revision'] or ref.get('sha256')!=inventory['sha256']:raise ValueError('Equipment source revision/hash does not match the scalar grid')
    connection=path['connection'];pattern=connection.get('pattern');r=pattern.get('radiation') if pattern else None
    if not r or template['sampled']['patternId']!=pattern['id']:raise ValueError('Choose the pattern explicitly linked to this antenna port')
    if ref.get('cellId')!=path['trace']['cell']['id'] or ref.get('linkId')!=connection['link']['id']:raise ValueError('The source cell/link does not match the pattern path')
    if connection['antenna'].get('model')!=r['antennaModel']:raise ValueError('The source antenna model does not match the pattern declared hardware model')
    if connection['antennaPort'].get('name') not in r['portNames']:raise ValueError('The physical antenna port name is not declared for this source pattern')
    g=prepared_pattern(pattern,inventory['sha256'],cache);g.check_carrier(template['frequencyMHz'],template['bandwidthMHz'])
    gain=template.get('gainDbi')
    finite(gain,-120,50,'Source-grid gain')
    if abs(gain-g.peak_gain_dbi(template['frequencyMHz']))>1e-9:raise ValueError('Source-grid peak gain must equal its derived frequency-dependent upper bound; do not add antenna or array gain')
    return g
