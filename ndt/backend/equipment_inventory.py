"""Source-backed equipment graphs, retained as immutable operator import revisions."""
from datetime import datetime, timezone
import hashlib
import json
import math
import re
from urllib.parse import urlsplit

COLLECTIONS=('sources','sites','sectors','radios','antennas','cells','ports','links','patterns')
MAX_BYTES=2000000


class InventoryConflict(ValueError):
    pass


def initialize_inventory(db):
    db.execute('''CREATE TABLE IF NOT EXISTS equipment_inventory_versions (
        region_id TEXT NOT NULL REFERENCES regions(id), project_id TEXT NOT NULL,
        revision INTEGER NOT NULL, sha256 TEXT NOT NULL, source_fingerprint TEXT NOT NULL,
        imported_at TEXT NOT NULL, raw BLOB NOT NULL,
        PRIMARY KEY(region_id,project_id,revision))''')


def text(value,label,maximum=160):
    if not isinstance(value,str) or not value.strip() or len(value)>maximum or any(ord(c)<32 for c in value):
        raise ValueError(f'{label}: nonempty plain text is required (maximum {maximum} characters)')
    return value


def number(value,label,low,high):
    if value is not None and (isinstance(value,bool) or not isinstance(value,(float,int)) or not low<=value<=high or not math.isfinite(value)):
        raise ValueError(f'{label}: use {low} to {high}, or null for unknown')


def validate_inventory(data,known_sites):
    if not isinstance(data,dict) or set(data)!={'schemaVersion',*COLLECTIONS} or type(data['schemaVersion']) is not int or data['schemaVersion']!=1:
        raise ValueError('Expected equipment schemaVersion 1 and all nine inventory collections')
    tables={}
    for kind in COLLECTIONS:
        rows=data[kind]
        if not isinstance(rows,list) or len(rows)>10000:
            raise ValueError(f'{kind}: expected at most 10000 records')
        tables[kind]={}
        for row in rows:
            identity=row.get('id') if isinstance(row,dict) else None
            if not isinstance(identity,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',identity) or identity in tables[kind]:
                raise ValueError(f'{kind}: invalid or duplicate ID {identity}')
            tables[kind][identity]=row
    if sum(len(rows) for rows in tables.values())>20000:
        raise ValueError('Inventory limit: 20000 records in total')
    def reference(row,field,kind,nullable=False):
        identity=row.get(field)
        if nullable and identity is None:return None
        if not isinstance(identity,str) or identity not in tables[kind]:
            raise ValueError(f"{row['id']}: {field} refers to missing {kind} record {identity}")
        return tables[kind][identity]
    for source in data['sources']:
        text(source.get('title'),f"Source {source['id']} title")
        uri=text(source.get('uri'),f"Source {source['id']} URI",2048)
        if urlsplit(uri).scheme.lower() not in ('http','https','urn'):
            raise ValueError('Source URI must use http, https or urn')
        try:
            observed=datetime.fromisoformat(source['observedAt'].replace('Z','+00:00'))
            if observed.tzinfo is None:raise ValueError()
        except (KeyError,TypeError,ValueError,AttributeError):
            raise ValueError(f"Source {source['id']}: observedAt requires an ISO timestamp with timezone") from None
        if source.get('kind') not in ('operator','vendor','survey','assumption'):
            raise ValueError('Source kind must be operator, vendor, survey or assumption')
    for kind in COLLECTIONS[1:]:
        for row in data[kind]:
            reference(row,'sourceId','sources')
            text(row.get('sourceRecordId'),f"{row['id']} sourceRecordId")
            for field in ('model','manufacturer','name'):
                if row.get(field) is not None:text(row[field],f"{row['id']} {field}")
    for site in data['sites']:
        text(site.get('inventorySiteId'),f"Site {site['id']} inventorySiteId",200)
        if site.get('inventorySiteId') not in known_sites:
            raise ValueError(f"Site {site['id']}: unknown regional inventorySiteId {site.get('inventorySiteId')}")
    for kind in ('sectors','radios','antennas'):
        for row in data[kind]:reference(row,'siteId','sites')
    for row in data['sectors']:number(row.get('azimuthDeg'),row['id']+' azimuth',0,359.999)
    for row in data['radios']:number(row.get('powerDbm'),row['id']+' TX power',-30,80)
    for row in data['antennas']:
        reference(row,'patternId','patterns',nullable=True)
        number(row.get('gainDbi'),row['id']+' gain',0,50)
        number(row.get('tiltDeg'),row['id']+' downtilt',-20,90)
    for cell in data['cells']:
        sector=reference(cell,'sectorId','sectors');radio=reference(cell,'radioId','radios',nullable=True)
        if radio and radio['siteId']!=sector['siteId']:raise ValueError(f"Cell {cell['id']}: radio and sector must belong to the same site")
        if cell.get('rat') not in ('LTE','NR'):raise ValueError(f"Cell {cell['id']}: RAT must be LTE or NR")
        if cell.get('cellIdentity') is not None:text(cell['cellIdentity'],cell['id']+' cellIdentity')
        number(cell.get('frequencyMHz'),cell['id']+' frequency (MHz)',500,100000)
        number(cell.get('bandwidthMHz'),cell['id']+' bandwidth (MHz)',.1,400)
        if cell.get('frequencyMHz') is not None and cell.get('bandwidthMHz') is not None and cell['bandwidthMHz']>=cell['frequencyMHz']:
            raise ValueError(f"Cell {cell['id']}: bandwidth must be smaller than carrier frequency")
    for port in data['ports']:
        if port.get('role') not in ('radio','antenna'):raise ValueError(f"Port {port['id']}: role must be radio or antenna")
        reference(port,'equipmentId','radios' if port['role']=='radio' else 'antennas')
    for link in data['links']:
        cell=reference(link,'cellId','cells');rp=reference(link,'radioPortId','ports');ap=reference(link,'antennaPortId','ports')
        if rp['role']!='radio' or ap['role']!='antenna' or rp['equipmentId']!=cell.get('radioId'):
            raise ValueError(f"Link {link['id']}: expected the cell's radio TX port and an antenna port")
        antenna=tables['antennas'][ap['equipmentId']];sector=tables['sectors'][cell['sectorId']]
        if antenna['siteId']!=sector['siteId']:raise ValueError(f"Link {link['id']}: antenna and cell must belong to the same site")
    for pattern in data['patterns']:
        for cut,extent in (('horizontal',180),('vertical',90)):
            points=pattern.get(cut)
            if not isinstance(points,list) or not 3<=len(points)<=721:raise ValueError(f"Pattern {pattern['id']}: {cut} needs 3 to 721 [angle, attenuation] samples")
            for point in points:
                if not isinstance(point,list) or len(point)!=2 or any(v is None for v in point):raise ValueError('Pattern samples need an angle and attenuation')
                number(point[0],'Pattern angle',-extent,extent);number(point[1],'Pattern attenuation (dB)',0,80)
            if points[0][0]!=-extent or points[-1][0]!=extent or any(a[0]>=b[0] for a,b in zip(points,points[1:])) or min(p[1] for p in points)!=0:
                raise ValueError(f"Pattern {pattern['id']}: {cut} must span {-extent} to {extent}, strictly ordered with a 0 dB peak")
            if cut=='horizontal' and abs(points[0][1]-points[-1][1])>1e-6:raise ValueError('Horizontal pattern endpoints must match at -180 and 180 degrees')
    return data


def trace_cell(data,identity,*,tables=None):
    tables=tables if tables is not None else {kind:{r['id']:r for r in data[kind]} for kind in COLLECTIONS}
    cell=tables['cells'][identity];sector=tables['sectors'][cell['sectorId']]
    connections=[]
    for link in data['links']:
        if link['cellId']!=identity:continue
        rp=tables['ports'][link['radioPortId']];ap=tables['ports'][link['antennaPortId']];antenna=tables['antennas'][ap['equipmentId']]
        connections.append(dict(link=link,radioPort=rp,antennaPort=ap,antenna=antenna,pattern=tables['patterns'].get(antenna.get('patternId'))))
    return dict(site=tables['sites'][sector['siteId']],sector=sector,cell=cell,
                radio=tables['radios'].get(cell.get('radioId')),connections=connections,sources=data['sources'])


def read_inventory(db,region,project,revision=None):
    row=db.execute('''SELECT revision,sha256,source_fingerprint,imported_at,raw FROM equipment_inventory_versions
        WHERE region_id=? AND project_id=? AND (? IS NULL OR revision=?) ORDER BY revision DESC LIMIT 1''',(region,project,revision,revision)).fetchone()
    if row is None:return None
    content=row[4].decode('utf-8') if isinstance(row[4],bytes) else row[4]
    history=[dict(revision=r[0],sha256=r[1],importedAt=r[2]) for r in db.execute('SELECT revision,sha256,imported_at FROM equipment_inventory_versions WHERE region_id=? AND project_id=? ORDER BY revision DESC',(region,project))]
    fingerprint=db.execute('SELECT fingerprint FROM regions WHERE id=?',(region,)).fetchone()
    return dict(revision=row[0],sha256=row[1],sourceFingerprint=row[2],currentSourceFingerprint=fingerprint[0] if fingerprint else None,importedAt=row[3],raw=content,data=json.loads(content.removeprefix('\ufeff')),history=history)


def preview_inventory(db,region,project,raw):
    if not isinstance(raw,bytes) or not 0<len(raw)<=MAX_BYTES:raise ValueError('Equipment import must be UTF-8 JSON of at most 2 MB')
    data=json.loads(raw.decode('utf-8-sig'))
    region_row=db.execute('SELECT metadata,fingerprint FROM regions WHERE id=?',(region,)).fetchone()
    if not region_row or not any(p['id']==project for p in json.loads(region_row[0])['projects']):raise LookupError('Unknown project')
    known={r[0] for r in db.execute('SELECT site_id FROM network_sites WHERE region_id=?',(region,))}
    validate_inventory(data,known)
    linked={link['cellId'] for link in data['links']}
    return dict(sha256=hashlib.sha256(raw).hexdigest(),sourceFingerprint=region_row[1],counts={k:len(data[k]) for k in COLLECTIONS},sources=data['sources'],unlinkedCells=sum(c['id'] not in linked for c in data['cells']))


def import_inventory(db,region,project,raw,expected_revision,expected_source=None):
    if type(expected_revision) is not int or expected_revision<0:raise ValueError('Expected a nonnegative inventory revision')
    db.execute('BEGIN IMMEDIATE')
    preview=preview_inventory(db,region,project,raw)
    if expected_source is not None and expected_source!=preview['sourceFingerprint']:
        raise InventoryConflict('Regional source inventory changed since preview. Preview the file again before importing.')
    current=read_inventory(db,region,project)
    if expected_revision!=(current['revision'] if current else 0):raise InventoryConflict('Equipment inventory changed elsewhere. Reload before importing; your file is retained.')
    if expected_revision>=50:raise ValueError('Inventory limit reached: 50 retained revisions')
    db.execute('INSERT INTO equipment_inventory_versions VALUES (?,?,?,?,?,?,?)',
               (region,project,expected_revision+1,preview['sha256'],preview['sourceFingerprint'],datetime.now(timezone.utc).isoformat(),raw))
    return read_inventory(db,region,project)
