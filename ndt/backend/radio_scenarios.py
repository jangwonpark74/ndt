"""Versioned radio study scenarios; revisions retain source identity and never mutate."""
import json
import math
import re
from datetime import datetime, timezone
from .carrier_plan import validate_carrier


class ScenarioConflict(ValueError):
    pass


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


def validate_radio_template(template):
    bounds = dict(frequencyMHz=(500, 100000), bandwidthMHz=(.1, 400), powerDbm=(-30, 80),
                  gainDbi=(0, 40), lossDb=(0, 40), tiltDeg=(-20, 90), azimuthDeg=(0, 359.999))
    if not isinstance(template, dict) or set(template)-{'carrier'} != set(bounds) | {'rat', 'pattern', 'mode'}:
        raise ValueError('A complete radio template is required')
    for field, (low, high) in bounds.items():
        value = template[field]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high or not math.isfinite(value):
            raise ValueError(f'Invalid {field}: expected {low} to {high}')
    if template['rat'] not in ('LTE', 'NR') or template['pattern'] not in ('element', 'isotropic') or template['mode'] not in ('LOS', 'NLOS'):
        raise ValueError('Unsupported RAT, antenna pattern or environment')
    if template['bandwidthMHz'] >= template['frequencyMHz']:
        raise ValueError('Bandwidth must be smaller than carrier frequency')
    if template['pattern'] == 'isotropic' and template['gainDbi'] != 0:
        raise ValueError('An isotropic antenna requires 0 dBi gain')
    validate_carrier(template)
    return template


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
        if expected >= 50:
            raise ValueError('Scenario limit reached: 50 retained revisions. Create a new scenario.')
        if not current and db.execute('SELECT COUNT(*) FROM radio_scenarios WHERE region_id=? AND project_id=?', (region, project)).fetchone()[0] >= 20:
            raise ValueError('Project limit reached: 20 scenarios')
        version = dict(revision=expected + 1, name=name.strip(), template=template, overrides=overrides,
                       sourceFingerprint=region_row[1], modelVersion='uma-element-v1',
                       createdAt=datetime.now(timezone.utc).isoformat())
        db.execute('''INSERT INTO radio_scenarios VALUES (?,?,?,?,?,NULL,NULL)
                      ON CONFLICT(region_id,project_id,scenario_id) DO UPDATE SET name=excluded.name,revision=excluded.revision''',
                   (region, project, identity, name.strip(), expected + 1))
        db.execute('INSERT INTO radio_scenario_versions VALUES (?,?,?,?,?)',
                   (region, project, identity, expected + 1, json.dumps(version, allow_nan=False)))
    else:
        version = json.loads(db.execute('SELECT payload FROM radio_scenario_versions WHERE region_id=? AND project_id=? AND scenario_id=? AND revision=?', (region, project, identity, expected)).fetchone()[0])
        if action == 'apply' and version['sourceFingerprint'] != region_row[1]:
            raise ValueError('Source inventory changed. Save a new revision before applying this scenario.')
        field = 'applied_revision' if action == 'apply' else 'baseline_revision'
        db.execute(f'UPDATE radio_scenarios SET {field}=? WHERE region_id=? AND project_id=? AND scenario_id=?',
                   (expected, region, project, identity))
    return next(s for s in list_scenarios(db, region, project) if s['id'] == identity)
