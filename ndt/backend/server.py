"""Serve the viewer and its region datasets from a local SQLite database."""
import argparse
from contextlib import closing
import errno
import hashlib
import json
import math
import mimetypes
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sqlite3
import sys
import tempfile
from urllib.parse import unquote, urlsplit, parse_qs
from .road_routing import driving_route, validate_points, RoutingUnavailable
from .task_store import connect, validate_tasks, initialize_tasks, read_tasks, write_tasks
from .dm.http import DriveTestAPI, DriveTestService
from .radio_scenarios import initialize_scenarios, list_scenarios, save_scenario, ScenarioConflict
from .equipment_inventory import initialize_inventory, read_inventory, preview_inventory, import_inventory, InventoryConflict
from .inventory_clusters import initialize_clusters, read_clusters, save_clusters, ClusterConflict

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
DATA_DIR = ROOT.parent / 'var'
DEFAULT_DB = DATA_DIR / 'regions.sqlite3'
LEGACY_DBS = (ROOT.parent / 'regions.sqlite3', ROOT / 'var' / 'regions.sqlite3')
LEGACY_DM_DBS = (ROOT.parent / 'drive_tests.sqlite3', ROOT / 'var' / 'tests.sqlite3')


class ViewerHTTPServer(ThreadingHTTPServer):
    # ES-module imports arrive in bursts; the default backlog of five drops connections on cold starts.
    request_queue_size = 64



def migrate_database(legacy, destination):
    if destination.exists() or not legacy.exists():
        return False
    fd, name = tempfile.mkstemp(prefix='.regions-migration-', suffix='.sqlite3', dir=destination.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        with closing(sqlite3.connect(f'{legacy.resolve().as_uri()}?mode=ro', uri=True)) as source, closing(sqlite3.connect(temporary)) as target:
            source.backup(target)
        try:
            os.link(temporary, destination)
        except FileExistsError:
            return False
        return True
    finally:
        temporary.unlink(missing_ok=True)


def migrate_first_available(candidates, destination):
    """Copy the first existing legacy database without overwriting a destination."""
    if destination.exists():
        return None
    for source in candidates:
        if migrate_database(source, destination):
            return source
        if destination.exists():
            break
    return None


def region_files(region):
    root = ROOT / region['data_root']
    for name in (region['roof'], *region['network_files']):
        yield name, root / name
    for folder in ('trees', 'street-detail'):
        for path in sorted((root / folder).rglob('*')):
            if path.is_file():
                yield path.relative_to(root).as_posix(), path


def import_network_dataset(db, region_id, path, content):
    """Import one complete source snapshot, retaining every feature and its order."""
    collection = json.loads(content)
    if not isinstance(collection, dict) or collection.get('type') != 'FeatureCollection' or not isinstance(collection.get('features'), list):
        raise ValueError(f'Invalid network dataset: {region_id}/{path}')
    features = collection.pop('features')
    rows = []
    seen = set()
    for ordinal, feature in enumerate(features):
        try:
            properties = feature['properties']
            site_id = properties.get('site_id', properties.get('id'))
            geometry = feature['geometry']
            coords = geometry['coordinates']
            if (feature['type'] != 'Feature' or geometry['type'] != 'Point' or
                not isinstance(site_id, str) or not site_id or site_id in seen or
                not isinstance(coords, list) or len(coords) < 2 or
                any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in coords[:2]) or
                not -180 <= coords[0] <= 180 or not -90 <= coords[1] <= 90):
                raise ValueError('Invalid or duplicate site ID or coordinates')
        except (KeyError, TypeError, AttributeError, ValueError) as error:
            raise ValueError(f'Invalid site in {region_id}/{path} at index {ordinal}') from error
        seen.add(site_id)
        rows.append((region_id, path, site_id, ordinal, json.dumps(feature, ensure_ascii=False)))
    db.execute('DELETE FROM network_sites WHERE region_id=? AND dataset_path=?', (region_id, path))
    db.execute('INSERT INTO network_datasets VALUES (?, ?, ?) ON CONFLICT(region_id, path) DO UPDATE SET metadata=excluded.metadata',
               (region_id, path, json.dumps(collection, ensure_ascii=False)))
    db.executemany('INSERT INTO network_sites (region_id, dataset_path, site_id, ordinal, feature) VALUES (?, ?, ?, ?, ?)', rows)


def network_collection(db, region_id, path):
    row = db.execute('SELECT metadata FROM network_datasets WHERE region_id=? AND path=?', (region_id, path)).fetchone()
    if row is None:
        return None
    collection = json.loads(row[0])
    collection['features'] = [json.loads(feature) for (feature,) in db.execute(
        'SELECT feature FROM network_sites WHERE region_id=? AND dataset_path=? ORDER BY ordinal', (region_id, path))]
    return collection


def initialize(db_path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    regions = json.loads((ROOT / 'regions.json').read_text(encoding='utf-8'))
    with closing(connect(db_path)) as db, db:
        db.executescript('''CREATE TABLE IF NOT EXISTS regions (id TEXT PRIMARY KEY, metadata TEXT NOT NULL, fingerprint TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS region_assets (region_id TEXT NOT NULL, path TEXT NOT NULL, content BLOB NOT NULL,
            PRIMARY KEY (region_id, path), FOREIGN KEY (region_id) REFERENCES regions(id));
            CREATE TABLE IF NOT EXISTS project_sites (region_id TEXT NOT NULL, project_id TEXT NOT NULL, site_ids TEXT NOT NULL,
            PRIMARY KEY (region_id, project_id), FOREIGN KEY (region_id) REFERENCES regions(id));
            CREATE TABLE IF NOT EXISTS project_use_cases (region_id TEXT NOT NULL, project_id TEXT NOT NULL,
            use_case TEXT NOT NULL CHECK(use_case IN ('virtual-drive-test', 'parameter-ab-test', 'ai-ran-benchmark')),
            PRIMARY KEY (region_id, project_id), FOREIGN KEY (region_id) REFERENCES regions(id));
            CREATE TABLE IF NOT EXISTS virtual_ues (region_id TEXT NOT NULL, project_id TEXT NOT NULL, ue_id TEXT NOT NULL,
            name TEXT NOT NULL, longitude REAL NOT NULL, latitude REAL NOT NULL,
            PRIMARY KEY (region_id, project_id, ue_id), FOREIGN KEY (region_id) REFERENCES regions(id));
            CREATE TABLE IF NOT EXISTS network_datasets (region_id TEXT NOT NULL, path TEXT NOT NULL, metadata TEXT NOT NULL,
            PRIMARY KEY (region_id, path));
            CREATE TABLE IF NOT EXISTS network_sites (region_id TEXT NOT NULL, dataset_path TEXT NOT NULL, site_id TEXT NOT NULL,
            ordinal INTEGER NOT NULL, feature TEXT NOT NULL CHECK(json_valid(feature)),
            longitude REAL GENERATED ALWAYS AS (json_extract(feature, '$.geometry.coordinates[0]')) STORED,
            latitude REAL GENERATED ALWAYS AS (json_extract(feature, '$.geometry.coordinates[1]')) STORED,
            PRIMARY KEY (region_id, dataset_path, site_id), UNIQUE (region_id, dataset_path, ordinal));
            CREATE INDEX IF NOT EXISTS network_sites_location ON network_sites(region_id, dataset_path, longitude, latitude);''')
        initialize_scenarios(db)
        initialize_clusters(db)
        initialize_inventory(db)
        for region in regions:
            files = list(region_files(region))
            required = {'trees/manifest.json', 'trees/overview.geojson', 'street-detail/manifest.json',
                        region['roof'], *region['network_files']}
            missing = required - {name for name, path in files if path.is_file()}
            if missing:
                raise RuntimeError(f"Missing {region['id']} data: {', '.join(sorted(missing))}")
            fingerprint = hashlib.sha256('\n'.join(f'{name}:{path.stat().st_size}:{path.stat().st_mtime_ns}' for name, path in files).encode()).hexdigest()
            old = db.execute('SELECT fingerprint FROM regions WHERE id=?', (region['id'],)).fetchone()
            db.execute('INSERT INTO regions VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata, fingerprint=excluded.fingerprint',
                       (region['id'], json.dumps(region), fingerprint))
            if not old or old[0] != fingerprint:
                db.execute('DELETE FROM region_assets WHERE region_id=?', (region['id'],))
                db.executemany('INSERT INTO region_assets VALUES (?, ?, ?)', ((region['id'], name, path.read_bytes()) for name, path in files))
                db.execute('DELETE FROM network_sites WHERE region_id=?', (region['id'],))
                db.execute('DELETE FROM network_datasets WHERE region_id=?', (region['id'],))
            for name in region['network_files']:
                if not db.execute('SELECT 1 FROM network_datasets WHERE region_id=? AND path=?', (region['id'], name)).fetchone():
                    asset = db.execute('SELECT content FROM region_assets WHERE region_id=? AND path=?', (region['id'], name)).fetchone()
                    if asset is None:
                        raise RuntimeError(f'Missing stored network data: {region["id"]}/{name}')
                    import_network_dataset(db, region['id'], name, asset[0])
        initialize_tasks(db)
    return regions


def handler_for(db_path):
    class Handler(DriveTestAPI, SimpleHTTPRequestHandler):
        # Windows file associations may otherwise advertise JS modules as text/plain.
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                          '.js': 'text/javascript', '.mjs': 'text/javascript'}
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(DIST), **kwargs)

        def do_GET(self):
            if self.handle_inventory_clusters('GET'):
                return
            if self.handle_equipment_inventory('GET'):
                return
            if self.handle_radio_scenarios('GET'):
                return
            if self.handle_dm('GET'):
                return
            path = unquote(urlsplit(self.path).path)
            task_parts = path.split('/')
            if len(task_parts) == 7 and task_parts[1:3] == ['api', 'regions'] and task_parts[4] == 'projects' and task_parts[6] == 'virtual-ues':
                with closing(connect(db_path)) as db:
                    if not self.known_project(db, task_parts[3], task_parts[5]):
                        return self.send_error(404)
                    rows = db.execute('SELECT ue_id, name, longitude, latitude FROM virtual_ues WHERE region_id=? AND project_id=? ORDER BY name, ue_id', (task_parts[3], task_parts[5]))
                    ues = [{'id':ue_id, 'name':name, 'longitude':longitude, 'latitude':latitude} for ue_id, name, longitude, latitude in rows]
                return self.respond(json.dumps(ues, ensure_ascii=False).encode(), 'application/json')
            if len(task_parts) == 7 and task_parts[1:3] == ['api', 'regions'] and task_parts[4] == 'projects' and task_parts[6] == 'tasks':
                with closing(connect(db_path)) as db:
                    if not self.known_project(db, task_parts[3], task_parts[5]):
                        return self.send_error(404)
                    tasks = read_tasks(db, task_parts[3], task_parts[5])
                return self.respond(json.dumps(tasks, ensure_ascii=False).encode(), 'application/json')
            if path == '/api/regions':
                with closing(connect(db_path)) as db, db:
                    body = json.dumps([json.loads(row[0]) for row in db.execute('SELECT metadata FROM regions ORDER BY rowid')]).encode()
                return self.respond(body, 'application/json')
            if path.startswith('/api/regions/'):
                parts = path.split('/', 5)
                if len(parts) == 5 and parts[4] == 'project-use-cases':
                    with closing(connect(db_path)) as db:
                        if not db.execute('SELECT 1 FROM regions WHERE id=?', (parts[3],)).fetchone():
                            return self.send_error(404)
                        categories = dict(db.execute('SELECT project_id, use_case FROM project_use_cases WHERE region_id=?', (parts[3],)))
                    return self.respond(json.dumps(categories).encode(), 'application/json')
                if len(parts) == 5 and parts[4] == 'projects':
                    with closing(connect(db_path)) as db, db:
                        if not db.execute('SELECT 1 FROM regions WHERE id=?', (parts[3],)).fetchone():
                            return self.send_error(404)
                        projects = {project_id: json.loads(site_ids) for project_id, site_ids in db.execute(
                            'SELECT project_id, site_ids FROM project_sites WHERE region_id=?', (parts[3],))}
                    return self.respond(json.dumps(projects).encode(), 'application/json')
                if len(parts) != 6 or parts[4] != 'assets':
                    return self.send_error(404)
                with closing(connect(db_path)) as db, db:
                    collection = network_collection(db, parts[3], parts[5])
                    row = (json.dumps(collection, ensure_ascii=False).encode(),) if collection is not None else db.execute(
                        'SELECT content FROM region_assets WHERE region_id=? AND path=?', (parts[3], parts[5])).fetchone()
                if row is None:
                    return self.send_error(404)
                return self.respond(row[0], mimetypes.guess_type(parts[5])[0] or 'application/json')
            return super().do_GET()

        def do_PUT(self):
            if self.handle_inventory_clusters('PUT'):
                return
            if self.handle_equipment_inventory('PUT'):
                return
            if self.handle_radio_scenarios('PUT'):
                return
            if self.handle_dm('PUT'):
                return
            parts = unquote(urlsplit(self.path).path).split('/')
            if len(parts) == 8 and parts[1:3] == ['api', 'regions'] and parts[4] == 'projects' and parts[6] == 'virtual-ues':
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 < length <= 2000:
                        raise ValueError('Invalid request size')
                    ue = json.loads(self.rfile.read(length))
                    if not isinstance(ue, dict) or set(ue) != {'name', 'longitude', 'latitude'}:
                        raise ValueError('Expected name, longitude and latitude')
                    name, lon, lat = ue['name'], ue['longitude'], ue['latitude']
                    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', parts[7]) or not isinstance(name, str) or not name.strip() or len(name) > 120:
                        raise ValueError('Invalid UE ID or name')
                    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (lon, lat)) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
                        raise ValueError('Invalid longitude or latitude')
                except (ValueError, UnicodeDecodeError, OverflowError) as error:
                    return self.send_error(400, str(error))
                with closing(connect(db_path)) as db, db:
                    if not self.known_project(db, parts[3], parts[5]):
                        return self.send_error(404)
                    db.execute('INSERT INTO virtual_ues VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(region_id, project_id, ue_id) DO UPDATE SET name=excluded.name, longitude=excluded.longitude, latitude=excluded.latitude',
                               (parts[3], parts[5], parts[7], name.strip(), lon, lat))
                return self.respond(json.dumps({'id':parts[7], 'name':name.strip(), 'longitude':lon, 'latitude':lat}, ensure_ascii=False).encode(), 'application/json')
            if len(parts) == 7 and parts[1:3] == ['api', 'regions'] and parts[4] == 'projects' and parts[6] == 'use-case':
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 < length <= 1000:
                        raise ValueError('Invalid request size')
                    payload = json.loads(self.rfile.read(length))
                    if not isinstance(payload, dict) or set(payload) != {'useCase'}:
                        raise ValueError('Expected useCase')
                    use_case = payload['useCase']
                    if use_case is not None and use_case not in ('virtual-drive-test', 'parameter-ab-test', 'ai-ran-benchmark'):
                        raise ValueError('Unknown project use case')
                except (ValueError, UnicodeDecodeError) as error:
                    return self.send_error(400, str(error))
                with closing(connect(db_path)) as db, db:
                    if not self.known_project(db, parts[3], parts[5]):
                        return self.send_error(404)
                    if use_case is None:
                        db.execute('DELETE FROM project_use_cases WHERE region_id=? AND project_id=?', (parts[3], parts[5]))
                    else:
                        db.execute('INSERT INTO project_use_cases VALUES (?, ?, ?) ON CONFLICT(region_id, project_id) DO UPDATE SET use_case=excluded.use_case',
                                   (parts[3], parts[5], use_case))
                return self.respond(json.dumps({'useCase':use_case}).encode(), 'application/json')
            if len(parts) == 7 and parts[1:3] == ['api', 'regions'] and parts[4] == 'projects' and parts[6] == 'tasks':
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 < length <= 2000000:
                        raise ValueError('Invalid request size')
                    tasks = validate_tasks(json.loads(self.rfile.read(length)))
                except (ValueError, UnicodeDecodeError) as error:
                    return self.send_error(400, str(error))
                with closing(connect(db_path)) as db, db:
                    if not self.known_project(db, parts[3], parts[5]):
                        return self.send_error(404)
                    write_tasks(db, parts[3], parts[5], tasks)
                    saved = read_tasks(db, parts[3], parts[5])
                return self.respond(json.dumps(saved, ensure_ascii=False).encode(), 'application/json')
            if len(parts) != 7 or parts[1:3] != ['api', 'regions'] or parts[4] != 'projects' or parts[6] != 'sites':
                return self.send_error(404)
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 100000:
                    raise ValueError('Invalid request size')
                site_ids = json.loads(self.rfile.read(length))
                if not isinstance(site_ids, list) or len(site_ids) > 1000 or not all(isinstance(value, str) for value in site_ids) or len(set(site_ids)) != len(site_ids):
                    raise ValueError('Expected unique site IDs')
            except (ValueError, UnicodeDecodeError):
                return self.send_error(400, 'Invalid site list')
            with closing(connect(db_path)) as db, db:
                region_row = db.execute('SELECT metadata FROM regions WHERE id=?', (parts[3],)).fetchone()
                region = json.loads(region_row[0]) if region_row else None
                if not region or region.get('network') != 'ised' or not any(project['id'] == parts[5] for project in region['projects']):
                    return self.send_error(404)
                valid_ids = {row[0] for row in db.execute('SELECT site_id FROM network_sites WHERE region_id=? AND dataset_path=?',
                                                         (parts[3], 'bell-outdoor-sites.geojson'))}
                if not set(site_ids) <= valid_ids:
                    return self.send_error(400, 'Unknown site ID')
                db.execute('INSERT INTO project_sites VALUES (?, ?, ?) ON CONFLICT(region_id, project_id) DO UPDATE SET site_ids=excluded.site_ids',
                           (parts[3], parts[5], json.dumps(site_ids)))
            return self.respond(b'{}', 'application/json')

        def do_DELETE(self):
            if self.handle_dm('DELETE'):
                return
            parts = unquote(urlsplit(self.path).path).split('/')
            if len(parts) != 8 or parts[1:3] != ['api', 'regions'] or parts[4] != 'projects' or parts[6] != 'virtual-ues':
                return self.send_error(404)
            with closing(connect(db_path)) as db, db:
                if not self.known_project(db, parts[3], parts[5]):
                    return self.send_error(404)
                db.execute('DELETE FROM virtual_ues WHERE region_id=? AND project_id=? AND ue_id=?', (parts[3], parts[5], parts[7]))
            return self.respond(b'{}', 'application/json')

        def do_POST(self):
            if self.handle_equipment_inventory('POST'):
                return
            if self.handle_dm('POST'):
                return
            if urlsplit(self.path).path != '/api/road-route':
                return self.send_error(404)
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 12000:
                    raise ValueError('Invalid request size')
                points = validate_points(json.loads(self.rfile.read(length)))
            except (ValueError, UnicodeDecodeError):
                return self.send_error(400, 'Invalid route guide points')
            try:
                result = driving_route(points)
            except RoutingUnavailable as error:
                return self.respond(json.dumps({'error':str(error)}).encode(), 'application/json', 503)
            return self.respond(json.dumps({'coordinates':result}).encode(), 'application/json')

        def do_PATCH(self):
            if not self.handle_dm('PATCH'):
                self.send_error(404)

        def handle_equipment_inventory(self, method):
            parsed=urlsplit(self.path)
            parts=unquote(parsed.path).split('/')
            if len(parts)!=7 or parts[1:3]!=['api','regions'] or parts[4]!='projects' or parts[6]!='equipment-inventory':return False
            if not self.dm_local():return True
            try:
                with closing(connect(db_path)) as db,db:
                    if not self.known_project(db,parts[3],parts[5]):raise LookupError('Unknown project')
                    if method=='GET':
                        value=parse_qs(parsed.query).get('revision',[None])[0]
                        if value is not None and (not value.isdecimal() or not 1<=int(value)<=50):raise ValueError('Revision must be 1 to 50')
                        result=read_inventory(db,parts[3],parts[5],int(value) if value is not None else None)
                        if result is None and value is not None:raise LookupError('Equipment revision not found')
                    else:
                        length=int(self.headers.get('Content-Length','0'))
                        if not 0<length<=4010000:raise ValueError('Equipment request is too large')
                        body=json.loads(self.rfile.read(length))
                        if not isinstance(body,dict) or not isinstance(body.get('raw'),str):raise ValueError('Expected the original equipment JSON text')
                        raw=body['raw'].encode('utf-8')
                        if method=='POST':result=preview_inventory(db,parts[3],parts[5],raw)
                        else:
                            fingerprint=body.get('sourceFingerprint')
                            if not isinstance(fingerprint,str) or not fingerprint:raise ValueError('Preview the equipment file before importing it')
                            result=import_inventory(db,parts[3],parts[5],raw,body.get('expectedRevision'),fingerprint)
                self.dm_json(200,result)
            except InventoryConflict as error:self.dm_json(409,{'error':str(error)})
            except (ValueError,UnicodeError) as error:self.dm_json(400,{'error':str(error)})
            except LookupError as error:self.dm_json(404,{'error':str(error)})
            except sqlite3.Error:self.dm_json(503,{'error':'Equipment storage unavailable. Your selected file is retained; retry.'})
            return True

        def handle_inventory_clusters(self, method):
            parts=unquote(urlsplit(self.path).path).split('/')
            if len(parts)!=7 or parts[1:3]!=['api','regions'] or parts[4]!='projects' or parts[6]!='inventory-clusters':
                return False
            if not self.dm_local():return True
            try:
                with closing(connect(db_path)) as db,db:
                    if method=='GET':
                        db.execute('BEGIN');result=read_clusters(db,parts[3],parts[5])
                    else:
                        length=int(self.headers.get('Content-Length','0'))
                        if not 0<length<=1000000:raise ValueError('Expected an inventory cluster request up to 1 MB')
                        result=save_clusters(db,parts[3],parts[5],json.loads(self.rfile.read(length)))
                self.dm_json(200,result)
            except ClusterConflict as error:self.dm_json(409,{'error':str(error)})
            except (ValueError,UnicodeError) as error:self.dm_json(400,{'error':str(error)})
            except LookupError as error:self.dm_json(404,{'error':str(error)})
            except sqlite3.Error:self.dm_json(503,{'error':'Inventory group storage unavailable. Your draft is retained; retry.'})
            return True

        def handle_radio_scenarios(self, method):
            parts = unquote(urlsplit(self.path).path).split('/')
            if len(parts) != 7 or parts[1:3] != ['api', 'regions'] or parts[4] != 'projects' or parts[6] != 'radio-scenarios':
                return False
            if not self.dm_local():
                return True
            try:
                with closing(connect(db_path)) as db, db:
                    if not self.known_project(db, parts[3], parts[5]):
                        self.dm_json(404, {'error': 'Unknown project'})
                        return True
                    if method == 'GET':
                        result = list_scenarios(db, parts[3], parts[5])
                    else:
                        length = int(self.headers.get('Content-Length', '0'))
                        if not 0 < length <= 4000000:
                            raise ValueError('Expected a scenario request of at most 4 MB')
                        body=json.loads(self.rfile.read(length))
                        if length>1000000 and (not isinstance(body,dict) or body.get('assignmentMode')!='cells'):
                            raise ValueError('Assumed-site scenario requests are limited to 1 MB')
                        result = save_scenario(db, parts[3], parts[5], body)
                self.dm_json(200, result)
            except ScenarioConflict as error:
                self.dm_json(409, {'error': str(error)})
            except (ValueError, UnicodeDecodeError) as error:
                self.dm_json(400, {'error': str(error)})
            except LookupError as error:
                self.dm_json(404, {'error': str(error)})
            except sqlite3.Error:
                self.dm_json(503, {'error': 'Scenario storage unavailable. Your draft is retained; retry.'})
            return True

        def known_project(self, db, region_id, project_id):
            row = db.execute('SELECT metadata FROM regions WHERE id=?', (region_id,)).fetchone()
            return row and any(project['id'] == project_id for project in json.loads(row[0])['projects'])

        def respond(self, body, content_type, status=200):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    return Handler


def bind_server(host, port, handler):
    ports = range(5179, 5190) if port is None else (port,)
    for candidate in ports:
        try:
            return ViewerHTTPServer((host, candidate), handler)
        except OSError as error:
            if error.errno != errno.EADDRINUSE:
                raise
            if port is not None:
                raise OSError(errno.EADDRINUSE, f'Port {port} is already in use') from error
    raise OSError(errno.EADDRINUSE, 'All default ports 5179-5189 are already in use')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, help='Use this exact port (default: first available in 5179-5189)')
    parser.add_argument('--db', type=Path, help='SQLite database path (default: var/regions.sqlite3 in the project directory)')
    parser.add_argument('--dm-db', type=Path, help='Drive-test registry path (default: drive_tests.sqlite3 beside the planning database)')
    parser.add_argument('--import-dm', type=Path, help='Copy an existing DM registry when the destination does not exist; never overwrite it')
    args = parser.parse_args()
    if args.import_dm and not args.import_dm.is_file():
        parser.error('The DM registry selected for import does not exist.')
    default_database = args.db is None
    if default_database:
        args.db = DEFAULT_DB
    try:
        httpd = bind_server(args.host, args.port, handler_for(args.db))
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            raise
        print(f'Cannot start viewer: {error.strerror}.', file=sys.stderr)
        return 1
    with httpd:
        if default_database:
            args.db.parent.mkdir(parents=True, exist_ok=True)
            source = migrate_first_available(LEGACY_DBS, args.db)
            if source:
                print(f'Copied existing database from {source} to {args.db}', flush=True)
        initialize(args.db)
        tests_db = args.dm_db or args.db.parent / 'drive_tests.sqlite3'
        tests_db.parent.mkdir(parents=True, exist_ok=True)
        if default_database and not args.dm_db and not args.import_dm:
            source = migrate_first_available(LEGACY_DM_DBS, tests_db)
            if source:
                print(f'Copied existing DM registry from {source} to {tests_db}', flush=True)
        if args.import_dm and migrate_database(args.import_dm, tests_db):
            print(f'Copied existing DM registry to {tests_db}', flush=True)
        httpd.drive_service = DriveTestService(args.db, tests_db)
        print(f'Serving on http://{args.host}:{httpd.server_address[1]} using {args.db}', flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nViewer stopped.', flush=True)
        finally:
            httpd.drive_service.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
