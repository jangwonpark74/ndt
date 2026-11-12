"""Read-only planning adapter and geographic route associations."""
from contextlib import closing
from copy import deepcopy
import hashlib
import json
import math
import sqlite3

from task_store import read_tasks
from .dm_model import Conflict

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
                 coordinates=site['geometry']['coordinates'][:2], frequency_mhz=frequency)
            for site, frequency in eligible]


def catalog(planning_db):
    result = dict(regions=[], tasks=[], message='')
    with closing(sqlite3.connect(planning_db.resolve().as_uri()+'?mode=ro', uri=True, timeout=3)) as db:
        db.execute('BEGIN')
        regions = [json.loads(row[0]) for row in db.execute('SELECT metadata FROM regions ORDER BY id')]
        result['regions'] = regions
        for region in regions:
            sites = [json.loads(row[0]) for row in db.execute(
                "SELECT feature FROM network_sites WHERE region_id=? AND dataset_path='bell-outdoor-sites.geojson' ORDER BY ordinal", (region['id'],))]
            for project in region['projects']:
                saved = db.execute('SELECT site_ids FROM project_sites WHERE region_id=? AND project_id=?', (region['id'], project['id'])).fetchone()
                network = transmitters(sites, json.loads(saved[0]) if saved else None, project['center']) if region.get('network') == 'ised' else []
                for task in read_tasks(db, region['id'], project['id']):
                    entry = dict(region_id=region['id'], region=region['name'], project_id=project['id'], project=project['name'],
                                 task_id=task['id'], task=task['name'], routes=task['routes'], routeMetrics=task['driveMetrics']['routes'], speedCases=task['speedCases'], transmitters=network)
                    entry['context_hash'] = digest(entry)
                    result['tasks'].append(entry)
    return result


def freeze_context(planning_db, selection):
    entry = next((t for t in catalog(planning_db)['tasks'] if all(t[k] == selection.get(k) for k in ('region_id', 'project_id', 'task_id'))), None)
    if entry is None:
        raise LookupError('The saved Task is unavailable. Return to planning and select a saved Task.')
    if entry['context_hash'] != selection.get('context_hash'):
        raise Conflict('Planning inputs changed. Refresh the Task selection before starting.')
    route = next((r for r in entry['routes'] if r['id'] == selection.get('route_id')), None)
    if route is None:
        raise ValueError('Select a saved Task route.')
    value = dict(schema='ndt.execution.v1', scope={k: entry[k] for k in ('region_id', 'region', 'project_id', 'project', 'task_id', 'task')},
                 route=deepcopy(route), speedCases=entry['speedCases'], transmitters=entry['transmitters'], context_hash=entry['context_hash'],
                 geometry_hash=digest(route['coordinates']), distance_version='haversine-r6371000-v1',
                 route_quality='legacy-fit-unverified' if route.get('roadFit') == 'fitted' else 'provisional',
                 original_geometry_available='originalCoordinates' in route or route.get('roadFit') != 'fitted')
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
