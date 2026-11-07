"""Serve the viewer and its region datasets from a local SQLite database."""
import argparse
import errno
import hashlib
import json
import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sqlite3
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'


def region_files(region):
    root = ROOT / region['data_root']
    for name in (region['roof'], *region['network_files']):
        yield name, root / name
    for folder in ('trees', 'street-detail'):
        for path in sorted((root / folder).rglob('*')):
            if path.is_file():
                yield path.relative_to(root).as_posix(), path


def initialize(db_path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    regions = json.loads((ROOT / 'regions.json').read_text())
    with sqlite3.connect(db_path) as db:
        db.executescript('''CREATE TABLE IF NOT EXISTS regions (id TEXT PRIMARY KEY, metadata TEXT NOT NULL, fingerprint TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS region_assets (region_id TEXT NOT NULL, path TEXT NOT NULL, content BLOB NOT NULL,
            PRIMARY KEY (region_id, path), FOREIGN KEY (region_id) REFERENCES regions(id));''')
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
    return regions


def handler_for(db_path):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(DIST), **kwargs)

        def do_GET(self):
            path = unquote(urlsplit(self.path).path)
            if path == '/api/regions':
                with sqlite3.connect(db_path) as db:
                    body = json.dumps([json.loads(row[0]) for row in db.execute('SELECT metadata FROM regions ORDER BY rowid')]).encode()
                return self.respond(body, 'application/json')
            if path.startswith('/api/regions/'):
                parts = path.split('/', 5)
                if len(parts) != 6 or parts[4] != 'assets':
                    return self.send_error(404)
                with sqlite3.connect(db_path) as db:
                    row = db.execute('SELECT content FROM region_assets WHERE region_id=? AND path=?', (parts[3], parts[5])).fetchone()
                if row is None:
                    return self.send_error(404)
                return self.respond(row[0], mimetypes.guess_type(parts[5])[0] or 'application/json')
            return super().do_GET()

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
    parser.add_argument('--db', type=Path, default=ROOT / 'var' / 'regions.sqlite3')
    args = parser.parse_args()
    try:
        httpd = bind_server(args.host, args.port, handler_for(args.db))
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            raise
        print(f'Cannot start viewer: {error.strerror}.', file=sys.stderr)
        return 1
    with httpd:
        initialize(args.db)
        print(f'Serving on http://{args.host}:{httpd.server_address[1]} using {args.db}', flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nViewer stopped.', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
