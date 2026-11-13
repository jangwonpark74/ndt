"""Versioned radio study scenarios; revisions retain source identity and never mutate."""
import json
import re
from datetime import datetime, timezone
from .equipment_studies import validate_equipment_templates
from .radio_templates import validate_radio_template
from .cell_assignments import resolve_cell_assignments
from .dm.polarization import validate_receiver_templates

RECEIVER_LIBRARY='uma-los-receiver-v5'


class ScenarioConflict(ValueError):
    pass


def validate_scenario_assignments(db,region,project,payload,*,current=False,qualified=False,cache=None):
    mode=payload.get('assignmentMode','sites')
    if mode not in ('sites','cells'):raise ValueError('Choose assumed site templates or imported cell/port assignments')
    if 'receiver' in payload and payload['receiver'] is None:raise ValueError('Provide an explicit receiver, or omit it for legacy ideal collection')
    if 'modelVersion' in payload and (payload['modelVersion']==RECEIVER_LIBRARY)!=('receiver' in payload):raise ValueError('Receiver inputs require their matching saved model version')
    if mode=='cells':
        if payload['overrides'] or 'equipmentSource' in payload['template']:raise ValueError('Cell assignment mode cannot mix assumed site overrides or source-linked defaults')
        resolved=resolve_cell_assignments(db,region,project,payload.get('cells'),payload.get('radioBudgets'),current=current,qualified=qualified,cache=cache)
        validate_receiver_templates(payload.get('receiver'),[payload['template'],*[p for c in payload['cells'] for p in c['ports']]])
        return resolved
    if any(t['pattern']=='sampled' for t in [payload['template'],*payload['overrides'].values()]):raise ValueError('Imported scalar grids require explicit cell assignment mode')
    if 'cells' in payload or 'radioBudgets' in payload:raise ValueError('Cell assignments and radio budgets require imported cell assignment mode')
    validate_receiver_templates(payload.get('receiver'),[payload['template'],*payload['overrides'].values()])
    validate_equipment_templates(db,region,project,payload['template'],payload['overrides'],current=current,cache=cache)


def initialize_scenarios(db):
    db.executescript('''
        CREATE TABLE IF NOT EXISTS radio_scenarios (
            region_id TEXT NOT NULL REFERENCES regions(id), project_id TEXT NOT NULL,
            scenario_id TEXT NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL,
            baseline_revision INTEGER, applied_revision INTEGER,
            PRIMARY KEY(region_id,project_id,scenario_id));
        CREATE TABLE IF NOT EXISTS radio_scenario_versions (
            region_id TEXT NOT NULL, project_id TEXT NOT NULL, scenario_id TEXT NOT NULL,
            revision INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
            PRIMARY KEY(region_id,project_id,scenario_id,revision),
            FOREIGN KEY(region_id,project_id,scenario_id) REFERENCES radio_scenarios);
    ''')


def list_scenarios(db, region, project):
    result = []
    for identity, name, revision, baseline, applied in db.execute(
            'SELECT scenario_id,name,revision,baseline_revision,applied_revision FROM radio_scenarios WHERE region_id=? AND project_id=? ORDER BY name,scenario_id', (region, project)):
        versions = [json.loads(row[0]) for row in db.execute(
            'SELECT payload FROM radio_scenario_versions WHERE region_id=? AND project_id=? AND scenario_id=? ORDER BY revision', (region, project, identity))]
        result.append(dict(id=identity, name=name, revision=revision, baselineRevision=baseline,
                           appliedRevision=applied, versions=versions))
    return result


def save_scenario(db, region, project, body):
    if not isinstance(body, dict):
        raise ValueError('Expected a scenario object')
    identity, expected, action = body.get('id'), body.get('expectedRevision'), body.get('action')
    if not isinstance(identity, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', identity):
        raise ValueError('Invalid scenario ID')
    if type(expected) is not int or expected < 0 or action not in ('save', 'apply', 'baseline'):
        raise ValueError('Invalid revision or scenario action')
    # Acquire the write lock before reading source identity or comparing revisions.
    db.execute('BEGIN IMMEDIATE')
    region_row = db.execute('SELECT metadata,fingerprint FROM regions WHERE id=?', (region,)).fetchone()
    if not region_row or not any(p['id'] == project for p in json.loads(region_row[0])['projects']):
        raise LookupError('Unknown project')
    current = db.execute('SELECT revision FROM radio_scenarios WHERE region_id=? AND project_id=? AND scenario_id=?', (region, project, identity)).fetchone()
    if expected != (current[0] if current else 0) or (not current and action != 'save'):
        raise ScenarioConflict('Scenario changed elsewhere. Reload saved versions; your draft is retained.')
    if action == 'save':
        name, template, overrides = body.get('name'), body.get('template'), body.get('overrides', {})
        if not isinstance(name, str) or not name.strip() or len(name) > 120 or any(ord(c) < 32 for c in name):
            raise ValueError('Scenario name is required (up to 120 plain-text characters)')
        validate_radio_template(template)
        if not isinstance(overrides, dict) or len(overrides) > 1000:
            raise ValueError('Expected at most 1000 site overrides')
        known_sites = {row[0] for row in db.execute('SELECT site_id FROM network_sites WHERE region_id=?', (region,))}
        if not set(overrides) <= known_sites:
            raise ValueError('Unknown override site ID')
        for override in overrides.values():
            validate_radio_template(override)
        validate_scenario_assignments(db,region,project,{**body,'overrides':overrides})
        if expected >= 50:
            raise ValueError('Scenario limit reached: 50 retained revisions. Create a new scenario.')
        if not current and db.execute('SELECT COUNT(*) FROM radio_scenarios WHERE region_id=? AND project_id=?', (region, project)).fetchone()[0] >= 20:
            raise ValueError('Project limit reached: 20 scenarios')
        version = dict(revision=expected + 1, name=name.strip(), template=template, overrides=overrides,
                       sourceFingerprint=region_row[1], modelVersion='uma-array-v2' if any(t['pattern']=='array' for t in [template,*overrides.values()]) else 'uma-element-v1',
                       createdAt=datetime.now(timezone.utc).isoformat())
        if body.get('assignmentMode')=='cells':
            version.update(assignmentMode='cells',cells=body['cells'],radioBudgets=body['radioBudgets'],modelVersion='uma-source-patterns-v4' if any(p['pattern']=='sampled' for c in body['cells'] for p in c['ports']) else 'uma-source-cells-v3')
        if 'receiver' in body:version.update(receiver=body['receiver'],modelVersion=RECEIVER_LIBRARY)
        db.execute('''INSERT INTO radio_scenarios VALUES (?,?,?,?,?,NULL,NULL)
                      ON CONFLICT(region_id,project_id,scenario_id) DO UPDATE SET name=excluded.name,revision=excluded.revision''',
                   (region, project, identity, name.strip(), expected + 1))
        db.execute('INSERT INTO radio_scenario_versions VALUES (?,?,?,?,?)',
                   (region, project, identity, expected + 1, json.dumps(version, allow_nan=False)))
    else:
        version = json.loads(db.execute('SELECT payload FROM radio_scenario_versions WHERE region_id=? AND project_id=? AND scenario_id=? AND revision=?', (region, project, identity, expected)).fetchone()[0])
        if action == 'apply' and version['sourceFingerprint'] != region_row[1]:
            raise ValueError('Source inventory changed. Save a new revision before applying this scenario.')
        validate_scenario_assignments(db,region,project,version,current=True)
        field = 'applied_revision' if action == 'apply' else 'baseline_revision'
        db.execute(f'UPDATE radio_scenarios SET {field}=? WHERE region_id=? AND project_id=? AND scenario_id=?',
                   (expected, region, project, identity))
    return next(s for s in list_scenarios(db, region, project) if s['id'] == identity)
