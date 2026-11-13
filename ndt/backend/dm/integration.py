"""Read-only planning adapter and geographic route associations."""
from contextlib import closing
from copy import deepcopy
import hashlib
import json
import math
import sqlite3

from ..task_store import read_tasks
from ..radio_scenarios import validate_radio_template
from ..carrier_plan import validate_carrier,PLAN
from ..equipment_inventory import read_inventory
from ..equipment_studies import validate_equipment_templates
from .dm_model import Conflict
from .model_versions import LEGACY_UMA,DIRECTIONAL_UMA,UMA_REFERENCE

EARTH_RADIUS_M = 6371000


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def distance(a, b):
    lat1, lat2 = map(math.radians, (a[1], b[1]))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(math.radians(b[0]-a[0])/2)**2
    return 2*EARTH_RADIUS_M*math.asin(min(1, math.sqrt(h)))


def number(value):
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def transmitters(sites, saved_ids, center):
    eligible = []
    for site in sites:
        bearings = {}
        for record in site['properties'].get('records', []):
            azimuth = number(record.get('tx_ant_azimuth'))
            widths = [number(w) for w in record.get('beamwidths', [record.get('tx_ant_horiz_beamwidth')])]
            frequencies = [number(f) for f in record.get('frequencies', [record.get('tx_frequency')])]
            usable = [f for f in frequencies if f is not None and 500 <= f <= 100000]
            if (record.get('tx_ant_omni_indicator') == 'D' and azimuth is not None and 0 <= azimuth < 360
                    and any(w is not None and 0 < w < 360 for w in widths) and usable):
                bearings.setdefault(azimuth, []).extend(usable)
        if len(bearings) == 3:
            eligible.append((site, min(f for group in bearings.values() for f in group)))
    if saved_ids is None and eligible:
        nearest = sorted(eligible, key=lambda item: (distance(item[0]['geometry']['coordinates'], center), item[0]['properties']['site_id']))
        anchor = nearest[0]
        eligible = [anchor, *sorted(nearest[1:], key=lambda item: (distance(item[0]['geometry']['coordinates'], anchor[0]['geometry']['coordinates']), item[0]['properties']['site_id']))[:6]]
    elif saved_ids is not None:
        by_id = {s['properties']['site_id']: (s, f) for s, f in eligible}
        eligible = [by_id[key] for key in saved_ids if key in by_id]
    return [dict(id=f"{site['properties']['site_id']}:{frequency:g}", site_id=site['properties']['site_id'],
                 label=f"{site['properties'].get('provider') or 'Bell'} {next((str(value) for value in site['properties'].get('ised_site_ids',[]) if value),site['properties']['site_id'])}",
                 coordinates=site['geometry']['coordinates'][:2], frequency_mhz=frequency)
            for site, frequency in eligible]


def scenario_transmitters(payload,network):
    if payload.get('modelVersion')!='uma-element-v1':raise ValueError('Unsupported saved scenario model version.')
    result=[]
    for transmitter in network:
        template=payload['overrides'].get(transmitter['site_id'],payload['template'])
        validate_radio_template(template);validate_carrier(template,required=True)
        eirp=template['powerDbm']+template['gainDbi']-template['lossDb']
        if not 0<=eirp<=90:raise ValueError(f"Site {transmitter['site_id']}: virtual drives support peak EIRP from 0 to 90 dBm.")
        result.append({**transmitter,'frequency_mhz':template['frequencyMHz'],'template':deepcopy(template)})
    if not result:raise ValueError('This project has no supported planning transmitters.')
    return result


def scenario_baseline(db,region,project,identity,revision,network,fingerprint,equipment_cache=None):
    if revision is None:raise ValueError('Set a saved baseline revision in the radio study library.')
    row=db.execute('SELECT payload FROM radio_scenario_versions WHERE region_id=? AND project_id=? AND scenario_id=? AND revision=?',(region,project,identity,revision)).fetchone()
    if not row:raise ValueError('Baseline revision is unavailable. Set a current saved baseline.')
    payload=json.loads(row[0])
    if payload['sourceFingerprint']!=fingerprint:raise ValueError('Baseline source inventory changed. Save and set a current baseline revision.')
    try:
        validate_equipment_templates(db,region,project,payload['template'],payload['overrides'],current=True,cache=equipment_cache)
        derived=scenario_transmitters(payload,network)
    except ValueError as error:raise ValueError(f'Baseline: {error}') from error
    return dict(id=identity,name=payload['name'],revision=revision,baselineRevision=revision,payload=payload),derived


def scenario_changes(baseline,applied,rat):
    sides=[{t['id']:t for t in rows if t['template']['rat']==rat} for rows in (baseline,applied)]
    result=[]
    fields=('frequencyMHz','mode','pattern','azimuthDeg','tiltDeg','powerDbm','gainDbi','lossDb','bandwidthMHz','carrier','equipmentSource')
    for identity in sorted(sides[0].keys() | sides[1].keys()):
        a,b=[side.get(identity) for side in sides];transmitter=b or a
        for field in (fields if a and b else ('assignment',)):
            before=a['template'].get(field) if a and field!='assignment' else rat if a else None
            after=b['template'].get(field) if b and field!='assignment' else rat if b else None
            if before==after:continue
            affects=field not in ('bandwidthMHz','carrier','equipmentSource') and not (field in ('azimuthDeg','tiltDeg') and a and b and a['template']['pattern']==b['template']['pattern']=='isotropic')
            result.append(dict(siteId=transmitter['site_id'],label=transmitter.get('label',transmitter['site_id']),parameter=field,baseline=before,applied=after,affectsPrediction=affects))
    return result


def project_radio_context(db,region,project,network,fingerprint):
    key=(region,project)
    equipment=db.execute('SELECT revision,sha256,source_fingerprint,imported_at FROM equipment_inventory_versions WHERE region_id=? AND project_id=? ORDER BY revision DESC LIMIT 1',key).fetchone()
    scenarios=[];equipment_cache={}
    for identity,name,revision,baseline,draft_revision in db.execute('SELECT scenario_id,name,applied_revision,baseline_revision,revision FROM radio_scenarios WHERE region_id=? AND project_id=? AND applied_revision IS NOT NULL ORDER BY name,scenario_id',key):
        row=db.execute('SELECT payload FROM radio_scenario_versions WHERE region_id=? AND project_id=? AND scenario_id=? AND revision=?',(*key,identity,revision)).fetchone()
        payload=json.loads(row[0]) if row else None;issue='';derived=[]
        if not payload:issue='Applied revision is missing. Restore a saved scenario.'
        else:
            if payload['sourceFingerprint']!=fingerprint:issue='Source inventory changed. Save and apply a new scenario revision.'
            try:
                validate_equipment_templates(db,region,project,payload['template'],payload['overrides'],current=True,cache=equipment_cache)
                derived=scenario_transmitters(payload,network)
            except ValueError as error:
                if not issue:issue=str(error)
        baseline_issue='';baseline_derived=[]
        try:_,baseline_derived=scenario_baseline(db,region,project,identity,baseline,network,fingerprint,equipment_cache)
        except ValueError as error:baseline_issue=str(error)
        scenarios.append(dict(id=identity,name=payload.get('name',name) if payload else name,revision=revision,draftRevision=draft_revision,baselineRevision=baseline,qualified=not bool(issue),issue=issue,
                              baselineQualified=not bool(baseline_issue),baselineIssue=baseline_issue,baselineRats=sorted({t['template']['rat'] for t in baseline_derived}),
                              transmitters=[dict(id=t['id'],site_id=t['site_id'],label=t.get('label',t['site_id']),rat=t['template']['rat'],frequency_mhz=t['frequency_mhz'],
                                                 eirp_dbm=t['template']['powerDbm']+t['template']['gainDbi']-t['template']['lossDb']) for t in derived]))
    return dict(id=f'{region}/{project}',region_id=region,project_id=project,sourceFingerprint=fingerprint,scenarios=scenarios,
                equipment=dict(zip(('revision','sha256','sourceFingerprint','importedAt'),equipment)) if equipment else None)


def _catalog(db):
    result = dict(regions=[], projects=[], tasks=[], message='')
    regions = [(json.loads(row[0]),row[1]) for row in db.execute('SELECT metadata,fingerprint FROM regions ORDER BY id')]
    result['regions'] = [region for region,_ in regions]
    for region,fingerprint in regions:
        sites = [json.loads(row[0]) for row in db.execute(
            "SELECT feature FROM network_sites WHERE region_id=? AND dataset_path='bell-outdoor-sites.geojson' ORDER BY ordinal", (region['id'],))]
        for project in region['projects']:
            saved = db.execute('SELECT site_ids FROM project_sites WHERE region_id=? AND project_id=?', (region['id'], project['id'])).fetchone()
            network = transmitters(sites, json.loads(saved[0]) if saved else None, project['center']) if region.get('network') == 'ised' else []
            context=project_radio_context(db,region['id'],project['id'],network,fingerprint)
            result['projects'].append(context)
            for task in read_tasks(db, region['id'], project['id']):
                entry = dict(region_id=region['id'], region=region['name'], project_id=project['id'], project=project['name'],
                             task_id=task['id'], task=task['name'], routes=task['routes'], routeMetrics=task['driveMetrics']['routes'], speedCases=task['speedCases'], transmitters=network,
                             radio_context_id=context['id'],radio_context_hash=digest(context))
                entry['context_hash'] = digest(entry)
                result['tasks'].append(entry)
    return result


def catalog(planning_db):
    with closing(sqlite3.connect(planning_db.resolve().as_uri()+'?mode=ro', uri=True, timeout=3)) as db:
        db.execute('BEGIN')
        return _catalog(db)


def freeze_context(planning_db, selection):
    with closing(sqlite3.connect(planning_db.resolve().as_uri()+'?mode=ro', uri=True, timeout=3)) as db:
        db.execute('BEGIN')
        return _freeze_context(db,selection)


def _freeze_context(db,selection):
    current=_catalog(db)
    entry = next((t for t in current['tasks'] if all(t[k] == selection.get(k) for k in ('region_id', 'project_id', 'task_id'))), None)
    if entry is None:
        raise LookupError('The saved Task is unavailable. Return to planning and select a saved Task.')
    if entry['context_hash'] != selection.get('context_hash'):
        raise Conflict('Planning inputs changed. Refresh the Task selection before starting.')
    route = next((r for r in entry['routes'] if r['id'] == selection.get('route_id')), None)
    if route is None:
        raise ValueError('Select a saved Task route.')
    value = dict(schema='ndt.execution.v1',predictionModel=LEGACY_UMA,modelReferences=[deepcopy(UMA_REFERENCE)],scope={k: entry[k] for k in ('region_id', 'region', 'project_id', 'project', 'task_id', 'task')},
                 route=deepcopy(route), speedCases=entry['speedCases'], transmitters=entry['transmitters'], context_hash=entry['context_hash'],
                 geometry_hash=digest(route['coordinates']), distance_version='haversine-r6371000-v1',
                 route_quality='legacy-fit-unverified' if route.get('roadFit') == 'fitted' else 'provisional',
                 original_geometry_available='originalCoordinates' in route or route.get('roadFit') != 'fitted')
    region,project=entry['region_id'],entry['project_id']
    context=next(c for c in current['projects'] if c['id']==entry['radio_context_id'])
    ids=[t['site_id'] for t in entry['transmitters']]
    features=[json.loads(row[0]) for row in db.execute(f"SELECT feature FROM network_sites WHERE region_id=? AND dataset_path='bell-outdoor-sites.geojson' AND site_id IN ({','.join('?' for _ in ids)}) ORDER BY ordinal",(region,*ids))] if ids else []
    membership=db.execute('SELECT site_ids FROM project_sites WHERE region_id=? AND project_id=?',(region,project)).fetchone()
    equipment=read_inventory(db,region,project)
    value['inventorySnapshot']=dict(regionalFingerprint=context['sourceFingerprint'],
        region=next(r for r in current['regions'] if r['id']==region),projectMembership=json.loads(membership[0]) if membership else None,
        licensedSites=features,operatorEquipment={k:equipment[k] for k in ('revision','sha256','sourceFingerprint','importedAt','raw')} if equipment else None,
        equipmentUsage='Retained source evidence; study templates, not imported hardware configuration, govern directional predictions.')
    identity=selection.get('scenario_id')
    if selection.get('experiment_type')=='scenario-ab' and not identity:raise ValueError('Choose a saved scenario with a baseline revision for scenario A/B.')
    if identity:
        scenario=next((s for s in context['scenarios'] if s['id']==identity),None)
        if scenario is None:raise LookupError('Applied scenario is unavailable. Refresh the planning selection.')
        if not scenario['qualified']:raise ValueError(scenario['issue'])
        row=db.execute('SELECT payload FROM radio_scenario_versions WHERE region_id=? AND project_id=? AND scenario_id=? AND revision=?',(region,project,identity,scenario['revision'])).fetchone()
        payload=json.loads(row[0])
        value['schema']='ndt.execution.v2'
        value['predictionModel']=DIRECTIONAL_UMA
        value['radioScenario']=dict(id=identity,name=payload['name'],revision=scenario['revision'],draftRevision=scenario['draftRevision'],baselineRevision=scenario['baselineRevision'],payload=payload)
        value['transmitters']=scenario_transmitters(payload,entry['transmitters'])
        if selection.get('experiment_type')=='scenario-ab':
            value['radioBaseline'],value['baselineTransmitters']=scenario_baseline(db,region,project,identity,scenario['baselineRevision'],entry['transmitters'],context['sourceFingerprint'])
            value['comparisonKind']='scenario-revisions'
            value['scenarioComparison']=dict(baselineRevision=scenario['baselineRevision'],appliedRevision=scenario['revision'],baselineName=value['radioBaseline']['name'],appliedName=payload['name'])
            value['scenarioChanges']=scenario_changes(value['baselineTransmitters'],value['transmitters'],selection.get('rat'))
        value['modelReferences'] += [dict(title=f"3GPP TS {'36.104' if rat=='LTE' else '38.104'} v{PLAN['edition']} Release {PLAN['release']}",url=PLAN['references'][rat],rat=rat)
                                    for rat in sorted({t['template']['rat'] for t in value['transmitters']+value.get('baselineTransmitters',[])})]
    value['id'] = 'SNAP-'+digest(value)[:24]
    return value


def route_lengths(coordinates):
    lengths = [0.0]
    for a, b in zip(coordinates, coordinates[1:]):
        lengths.append(lengths[-1]+distance(a, b))
    return lengths


def match_route(rows, route, *, direction='forward', tolerance_m=50, gap_ms=10000):
    if direction not in ('forward', 'reverse') or not 1 <= tolerance_m <= 200:
        raise ValueError('Use forward/reverse direction and a 1–200 m matching tolerance.')
    coordinates = route['coordinates']
    lengths = route_lengths(coordinates)
    matches, intervals = [], []
    previous = None
    fixed_timestamps = {row['t'] for row in rows if 'latitude' in row and 'longitude' in row}
    for index, row in enumerate(rows):
        item = dict(index=index, t=row['t'], rat=row['rat'])
        if 'latitude' not in row or 'longitude' not in row:
            item['status'] = 'missing-gps'
            if row['t'] not in fixed_timestamps:
                previous = None
        else:
            candidates = []
            point = [row['longitude'], row['latitude']]
            for i, (a, b) in enumerate(zip(coordinates, coordinates[1:])):
                scale = math.cos(math.radians((a[1]+b[1]+point[1])/3))
                dx, dy = math.radians(b[0]-a[0])*scale*EARTH_RADIUS_M, math.radians(b[1]-a[1])*EARTH_RADIUS_M
                px, py = math.radians(point[0]-a[0])*scale*EARTH_RADIUS_M, math.radians(point[1]-a[1])*EARTH_RADIUS_M
                fraction = max(0, min(1, (px*dx+py*dy)/(dx*dx+dy*dy))) if dx*dx+dy*dy else 0
                error = math.hypot(px-fraction*dx, py-fraction*dy)
                candidates.append((error, lengths[i]+fraction*(lengths[i+1]-lengths[i])))
            error, chainage = min(candidates)
            near = [s for e, s in candidates if e <= error+3 and abs(s-chainage) > 20]
            continuous = previous and row['t']-previous['t'] <= gap_ms
            if near and continuous:
                viable = [(e, s) for e, s in candidates if e <= error+3 and abs(s-previous['chainage_m']) <= distance(point, previous['coordinates'])+tolerance_m]
                if viable:
                    error, chainage = min(viable, key=lambda p: abs(p[1]-previous['chainage_m']))
                    near = [s for e, s in viable if abs(s-chainage) > 20]
            status = 'off-route' if error > tolerance_m else 'ambiguous' if near else 'matched'
            if status == 'matched' and continuous and (chainage-previous['chainage_m'])*(1 if direction == 'forward' else -1) < -10:
                status = 'wrong-direction'
            item.update(status=status, chainage_m=chainage, lateral_error_m=error)
            if status == 'matched':
                if continuous:
                    intervals.append(sorted((previous['chainage_m'], chainage)))
                previous = dict(t=row['t'], chainage_m=chainage, coordinates=point)
            else:
                previous = None
        matches.append(item)
    merged = []
    for lo, hi in sorted(intervals):
        if merged and lo <= merged[-1][1]:
            merged[-1][1] = max(hi, merged[-1][1])
        else:
            merged.append([lo, hi])
    covered = sum(hi-lo for lo, hi in merged)
    return dict(schema='ndt.route-association.v1', direction=direction, tolerance_m=tolerance_m, gap_ms=gap_ms,
                route_length_m=lengths[-1], route_coverage_pct=100*covered/lengths[-1] if lengths[-1] else 0,
                matched_samples=sum(m['status'] == 'matched' for m in matches), samples=matches)
