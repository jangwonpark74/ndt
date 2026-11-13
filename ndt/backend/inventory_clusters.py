"""Independent, named inventory review groups with conflict-safe project storage."""
from datetime import datetime,timezone
import json,re

class ClusterConflict(ValueError):pass

def initialize_clusters(db):
    db.execute('''CREATE TABLE IF NOT EXISTS inventory_clusters (
        region_id TEXT NOT NULL REFERENCES regions(id),project_id TEXT NOT NULL,
        revision INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),
        PRIMARY KEY(region_id,project_id))''')

def project_source(db,region,project):
    row=db.execute('SELECT metadata,fingerprint FROM regions WHERE id=?',(region,)).fetchone()
    if not row or not any(p['id']==project for p in json.loads(row[0])['projects']):raise LookupError('Unknown project')
    return row[1]

def read_clusters(db,region,project):
    fingerprint=project_source(db,region,project)
    row=db.execute('SELECT revision,payload FROM inventory_clusters WHERE region_id=? AND project_id=?',(region,project)).fetchone()
    value=json.loads(row[1]) if row else dict(clusters=[],sourceFingerprint=fingerprint,updatedAt=None)
    known={r[0] for r in db.execute('SELECT site_id FROM network_sites WHERE region_id=?',(region,))}
    missing=sorted({site for cluster in value['clusters'] for site in cluster['siteIds'] if site not in known})
    return {**value,'revision':row[0] if row else 0,'currentSourceFingerprint':fingerprint,'missingSiteIds':missing}

def save_clusters(db,region,project,body):
    if not isinstance(body,dict) or set(body)!={'expectedRevision','sourceFingerprint','clusters'}:raise ValueError('Expected cluster list, revision and source identity')
    db.execute('BEGIN IMMEDIATE')
    fingerprint=project_source(db,region,project)
    current=db.execute('SELECT revision FROM inventory_clusters WHERE region_id=? AND project_id=?',(region,project)).fetchone()
    expected=body['expectedRevision']
    if type(expected) is not int or expected<0:raise ValueError('Invalid cluster revision')
    if expected!=(current[0] if current else 0) or body['sourceFingerprint']!=fingerprint:raise ClusterConflict('Inventory clusters or source changed. Reload saved groups; your draft is retained.')
    clusters=body['clusters']
    if not isinstance(clusters,list) or len(clusters)>50:raise ValueError('A project supports at most 50 inventory clusters')
    known={r[0] for r in db.execute('SELECT site_id FROM network_sites WHERE region_id=?',(region,))}
    ids,names,assignments=set(),set(),0
    for cluster in clusters:
        if not isinstance(cluster,dict) or set(cluster)!={'id','name','siteIds'}:raise ValueError('Each cluster needs an ID, name and site IDs')
        identity,name,sites=cluster['id'],cluster['name'],cluster['siteIds']
        if not isinstance(identity,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',identity) or identity in ids:raise ValueError('Cluster IDs must be unique plain identifiers')
        if not isinstance(name,str) or name!=name.strip() or not name or len(name)>80 or any(ord(c)<32 for c in name) or name.casefold() in names:raise ValueError('Cluster names must be unique, 1–80 plain-text characters')
        if not isinstance(sites,list) or len(sites)>1000 or not all(isinstance(s,str) for s in sites) or len(set(sites))!=len(sites) or not set(sites)<=known:raise ValueError('Choose up to 1000 unique current regional inventory sites per cluster')
        ids.add(identity);names.add(name.casefold());assignments+=len(sites)
    if assignments>10000:raise ValueError('A project supports at most 10000 cluster assignments')
    value=dict(clusters=clusters,sourceFingerprint=fingerprint,updatedAt=datetime.now(timezone.utc).isoformat())
    db.execute('INSERT INTO inventory_clusters VALUES (?,?,?,?) ON CONFLICT(region_id,project_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload',(region,project,expected+1,json.dumps(value,ensure_ascii=False)))
    return read_clusters(db,region,project)
