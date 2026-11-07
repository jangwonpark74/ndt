"""Serve the viewer and its region datasets from a local SQLite database."""
import argparse
from contextlib import closing
import errno
import hashlib
import json
import math
import mimetypes
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sqlite3
import sys
import tempfile
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
DEFAULT_DB = ROOT.parent / 'regions.sqlite3'
LEGACY_DB = ROOT / 'var' / 'regions.sqlite3'


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
    regions = json.loads((ROOT / 'regions.json').read_text())
    with closing(sqlite3.connect(db_path)) as db, db:
        db.executescript('''CREATE TABLE IF NOT EXISTS regions (id TEXT PRIMARY KEY, metadata TEXT NOT NULL, fingerprint TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS region_assets (region_id TEXT NOT NULL, path TEXT NOT NULL, content BLOB NOT NULL,
            PRIMARY KEY (region_id, path), FOREIGN KEY (region_id) REFERENCES regions(id));
            CREATE TABLE IF NOT EXISTS project_sites (region_id TEXT NOT NULL, project_id TEXT NOT NULL, site_ids TEXT NOT NULL,
            PRIMARY KEY (region_id, project_id), FOREIGN KEY (region_id) REFERENCES regions(id));
            CREATE TABLE IF NOT EXISTS network_datasets (region_id TEXT NOT NULL, path TEXT NOT NULL, metadata TEXT NOT NULL,
            PRIMARY KEY (region_id, path));
            CREATE TABLE IF NOT EXISTS network_sites (region_id TEXT NOT NULL, dataset_path TEXT NOT NULL, site_id TEXT NOT NULL,
            ordinal INTEGER NOT NULL, feature TEXT NOT NULL CHECK(json_valid(feature)),
            longitude REAL GENERATED ALWAYS AS (json_extract(feature, '$.geometry.coordinates[0]')) STORED,
            latitude REAL GENERATED ALWAYS AS (json_extract(feature, '$.geometry.coordinates[1]')) STORED,
            PRIMARY KEY (region_id, dataset_path, site_id), UNIQUE (region_id, dataset_path, ordinal));
            CREATE INDEX IF NOT EXISTS network_sites_location ON network_sites(region_id, dataset_path, longitude, latitude);''')
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
    return regions


def handler_for(db_path):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(DIST), **kwargs)

        def do_GET(self):
            path = unquote(urlsplit(self.path).path)
            if path == '/api/regions':
                with closing(sqlite3.connect(db_path)) as db, db:
                    body = json.dumps([json.loads(row[0]) for row in db.execute('SELECT metadata FROM regions ORDER BY rowid')]).encode()
                return self.respond(body, 'application/json')
            if path.startswith('/api/regions/'):
                parts = path.split('/', 5)
                if len(parts) == 5 and parts[4] == 'projects':
                    with closing(sqlite3.connect(db_path)) as db, db:
                        if not db.execute('SELECT 1 FROM regions WHERE id=?', (parts[3],)).fetchone():
                            return self.send_error(404)
                        projects = {project_id: json.loads(site_ids) for project_id, site_ids in db.execute(
                            'SELECT project_id, site_ids FROM project_sites WHERE region_id=?', (parts[3],))}
                    return self.respond(json.dumps(projects).encode(), 'application/json')
                if len(parts) != 6 or parts[4] != 'assets':
                    return self.send_error(404)
                with closing(sqlite3.connect(db_path)) as db, db:
                    collection = network_collection(db, parts[3], parts[5])
                    row = (json.dumps(collection, ensure_ascii=False).encode(),) if collection is not None else db.execute(
                        'SELECT content FROM region_assets WHERE region_id=? AND path=?', (parts[3], parts[5])).fetchone()
                if row is None:
                    return self.send_error(404)
                return self.respond(row[0], mimetypes.guess_type(parts[5])[0] or 'application/json')
            return super().do_GET()

        def do_PUT(self):
            parts = unquote(urlsplit(self.path).path).split('/')
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
            with closing(sqlite3.connect(db_path)) as db, db:
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

        def respond(self, body, content_type):
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    return Handler


def bind_server(host, port, handler):
    ports = range(5179, 5190) if port is None else (port,)
    for candidate in ports:
        try:
            return ThreadingHTTPServer((host, candidate), handler)
        except OSError as error:
            if error.errno != errno.EADDRINUSE:
                raise
            if port is not None:
                raise OSError(errno.EADDRINUSE, f'Port {port} is already in use') from error
    raise OSError(errno.EADDRINUSE, 'All default ports 5179–5189 are already in use')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, help='Use this exact port (default: first available in 5179–5189)')
    parser.add_argument('--db', type=Path, help='SQLite database path (default: regions.sqlite3 in the project directory)')
    args = parser.parse_args()
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
        if default_database and migrate_database(LEGACY_DB, args.db):
            print(f'Copied existing database from {LEGACY_DB} to {args.db}', flush=True)
        initialize(args.db)
        print(f'Serving on http://{args.host}:{httpd.server_address[1]} using {args.db}', flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nViewer stopped.', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
