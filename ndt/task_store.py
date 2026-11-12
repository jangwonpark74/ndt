"""Relational drive-task storage and SQL-derived route metrics."""
import json
import math
import re
import sqlite3
from road_routing import validate_points


def connect(path):
    db = sqlite3.connect(path, timeout=5)
    db.execute('PRAGMA foreign_keys=ON')
    return db


def speed_cases(task):
    primary=task.get('driveSpeedKmh')
    def legacy(speed):
        return dict(id='CASE-001',name=f'{speed:g} km/h' if isinstance(speed,(int,float)) else 'Drive speed',speedKmh=speed)
    cases=task['speedCases'] if 'speedCases' in task else [] if primary is None else [legacy(primary)]
    if not isinstance(cases,list) or len(cases)>20:
        raise ValueError('Expected at most 20 speed cases')
    ids,speeds=set(),set()
    for case in cases:
        if not isinstance(case,dict) or not isinstance(case.get('id'),str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',case['id']) or case['id'] in ids:
            raise ValueError('Invalid or duplicate speed case ID')
        name,speed=case.get('name'),case.get('speedKmh')
        if not isinstance(name,str) or not name.strip() or len(name)>120:
            raise ValueError('Speed case name is required')
        if isinstance(speed,bool) or not isinstance(speed,(int,float)) or not math.isfinite(speed) or not .1<=speed<=200 or speed in speeds:
            raise ValueError('Speed cases need unique speeds from 0.1 to 200 km/h')
        ids.add(case['id']);speeds.add(speed)
    if primary is not None:
        if isinstance(primary,bool) or not isinstance(primary,(int,float)) or not math.isfinite(primary) or not .1<=primary<=200:
            raise ValueError('Invalid primary drive speed')
        if not cases:
            cases=[legacy(primary)]
        elif cases[0]['speedKmh']!=primary:
            if primary in {case['speedKmh'] for case in cases[1:]}:
                raise ValueError('Primary drive speed duplicates another case; refresh the viewer')
            old=cases[0];name=f'{primary:g} km/h' if old['name']==f"{old['speedKmh']:g} km/h" else old['name']
            cases=[{**old,'speedKmh':primary,'name':name},*cases[1:]]
    return cases


def validate_tasks(tasks):
    if not isinstance(tasks, list) or len(tasks) > 100:
        raise ValueError('Expected at most 100 tasks')
    ids, point_count = set(), 0
    for task in tasks:
        if not isinstance(task, dict):
            raise ValueError('Invalid task')
        task_id, name, routes = task.get('id'), task.get('name'), task.get('routes')
        if not isinstance(task_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', task_id) or task_id in ids:
            raise ValueError('Task IDs must be unique and contain letters, numbers, underscores or hyphens')
        ids.add(task_id)
        if not isinstance(name, str) or not name.strip() or len(name) > 120:
            raise ValueError('Task name is required (up to 120 characters)')
        speed = task.get('driveSpeedKmh')
        if speed is not None and (isinstance(speed, bool) or not isinstance(speed, (int, float)) or not math.isfinite(speed) or not 0.1 <= speed <= 200):
            raise ValueError('Drive speed must be between 0.1 and 200 km/h, or null')
        speed_cases(task)
        if not isinstance(routes, list) or len(routes) > 50:
            raise ValueError('Expected at most 50 routes per task')
        route_ids = set()
        for route in routes:
            if not isinstance(route, dict):
                raise ValueError('Invalid route')
            route_id, route_name, points = route.get('id'), route.get('name'), route.get('coordinates')
            if not isinstance(route_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', route_id) or route_id in route_ids:
                raise ValueError('Invalid or duplicate route ID')
            route_ids.add(route_id)
            if not isinstance(route_name, str) or not route_name.strip() or len(route_name) > 120:
                raise ValueError('Route name is required (up to 120 characters)')
            if not isinstance(points, list) or not 2 <= len(points) <= 5000:
                raise ValueError('Each route needs 2 to 5000 points')
            for point in points:
                if (not isinstance(point, list) or len(point) != 2 or
                    any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in point) or
                    not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
                    raise ValueError('Invalid longitude/latitude coordinate')
            if all(point == points[0] for point in points):
                raise ValueError('A route needs two distinct points')
            if 'roadFit' in route and route['roadFit'] not in ('fitted', 'unmatched'):
                raise ValueError('Invalid road fitting status')
            if 'waypoints' in route:
                validate_points(route['waypoints'])
            if 'originalCoordinates' in route:
                validate_points(route['originalCoordinates'], 5000)
            if 'fitMessage' in route and (not isinstance(route['fitMessage'], str) or len(route['fitMessage']) > 240):
                raise ValueError('Invalid road fitting message')
            point_count += len(points)
            if point_count > 10000:
                raise ValueError('Project routes exceed 10000 points')
    return tasks


TABLES = (
    '''CREATE TABLE IF NOT EXISTS drive_tasks (
        region_id TEXT NOT NULL REFERENCES regions(id), project_id TEXT NOT NULL, task_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK(ordinal>=0), name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
        attributes TEXT NOT NULL CHECK(json_valid(attributes)),
        PRIMARY KEY(region_id,project_id,task_id), UNIQUE(region_id,project_id,ordinal))''',
    '''CREATE TABLE IF NOT EXISTS drive_speed_cases (
        region_id TEXT NOT NULL,project_id TEXT NOT NULL,task_id TEXT NOT NULL,case_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK(ordinal>=0),name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
        speed_kmh REAL NOT NULL CHECK(speed_kmh BETWEEN 0.1 AND 200),
        PRIMARY KEY(region_id,project_id,task_id,case_id),UNIQUE(region_id,project_id,task_id,ordinal),UNIQUE(region_id,project_id,task_id,speed_kmh),
        FOREIGN KEY(region_id,project_id,task_id) REFERENCES drive_tasks ON DELETE CASCADE)''',
    '''CREATE TABLE IF NOT EXISTS drive_routes (
        region_id TEXT NOT NULL, project_id TEXT NOT NULL, task_id TEXT NOT NULL, route_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK(ordinal>=0), name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
        road_fit TEXT CHECK(road_fit IN ('fitted','unmatched')), fit_message TEXT CHECK(length(fit_message)<=240),
        attributes TEXT NOT NULL CHECK(json_valid(attributes)),
        PRIMARY KEY(region_id,project_id,task_id,route_id), UNIQUE(region_id,project_id,task_id,ordinal),
        FOREIGN KEY(region_id,project_id,task_id) REFERENCES drive_tasks ON DELETE CASCADE)''',
    '''CREATE TABLE IF NOT EXISTS drive_route_points (
        region_id TEXT NOT NULL, project_id TEXT NOT NULL, task_id TEXT NOT NULL, route_id TEXT NOT NULL,
        point_kind TEXT NOT NULL CHECK(point_kind IN ('path','guide')), ordinal INTEGER NOT NULL CHECK(ordinal>=0),
        longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180), latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
        PRIMARY KEY(region_id,project_id,task_id,route_id,point_kind,ordinal),
        FOREIGN KEY(region_id,project_id,task_id,route_id) REFERENCES drive_routes ON DELETE CASCADE)''',
)

SPEED_VIEW = '''CREATE VIEW drive_task_speeds AS SELECT t.*,
    (SELECT speed_kmh FROM drive_speed_cases c WHERE (c.region_id,c.project_id,c.task_id)=(t.region_id,t.project_id,t.task_id) ORDER BY ordinal LIMIT 1) AS drive_speed_kmh
    FROM drive_tasks t'''

ROUTE_VIEW = '''CREATE VIEW IF NOT EXISTS drive_route_details AS
WITH previous AS (
    SELECT *, lag(longitude) OVER route_order AS prev_lon, lag(latitude) OVER route_order AS prev_lat
    FROM drive_route_points WHERE point_kind='path'
    WINDOW route_order AS (PARTITION BY region_id,project_id,task_id,route_id ORDER BY ordinal)
), arcs AS (
    SELECT *, sin(radians(latitude-prev_lat)/2)*sin(radians(latitude-prev_lat)/2)
        + cos(radians(latitude))*cos(radians(prev_lat))*sin(radians(longitude-prev_lon)/2)*sin(radians(longitude-prev_lon)/2) AS h
    FROM previous
), lengths AS (
    SELECT region_id,project_id,task_id,route_id,count(*) AS point_count,
        sum(CASE WHEN h IS NULL THEN 0 ELSE 12742.0*asin(sqrt(min(1.0,max(0.0,h)))) END) AS distance_km
    FROM arcs GROUP BY region_id,project_id,task_id,route_id
)
SELECT r.*, coalesce(l.point_count,0) AS point_count, t.drive_speed_kmh,
    CASE WHEN l.point_count>=2 THEN l.distance_km END AS distance_km,
    CASE WHEN l.point_count>=2 AND t.drive_speed_kmh IS NOT NULL THEN l.distance_km/t.drive_speed_kmh*3600 END AS estimated_duration_s,
    (SELECT longitude FROM drive_route_points p WHERE (p.region_id,p.project_id,p.task_id,p.route_id)=(r.region_id,r.project_id,r.task_id,r.route_id) AND point_kind='path' ORDER BY ordinal LIMIT 1) AS start_longitude,
    (SELECT latitude FROM drive_route_points p WHERE (p.region_id,p.project_id,p.task_id,p.route_id)=(r.region_id,r.project_id,r.task_id,r.route_id) AND point_kind='path' ORDER BY ordinal LIMIT 1) AS start_latitude,
    (SELECT longitude FROM drive_route_points p WHERE (p.region_id,p.project_id,p.task_id,p.route_id)=(r.region_id,r.project_id,r.task_id,r.route_id) AND point_kind='path' ORDER BY ordinal DESC LIMIT 1) AS end_longitude,
    (SELECT latitude FROM drive_route_points p WHERE (p.region_id,p.project_id,p.task_id,p.route_id)=(r.region_id,r.project_id,r.task_id,r.route_id) AND point_kind='path' ORDER BY ordinal DESC LIMIT 1) AS end_latitude
FROM drive_routes r JOIN drive_task_speeds t USING(region_id,project_id,task_id)
LEFT JOIN lengths l USING(region_id,project_id,task_id,route_id)'''

TASK_VIEW = '''CREATE VIEW IF NOT EXISTS drive_task_details AS
WITH totals AS (
    SELECT region_id,project_id,task_id,count(*) AS route_count,sum(distance_km) AS distance_km,
        max(CASE WHEN road_fit='fitted' THEN 0 ELSE 1 END) AS is_provisional
    FROM drive_route_details GROUP BY region_id,project_id,task_id
)
SELECT t.*,coalesce(s.route_count,0) AS route_count,s.distance_km,coalesce(s.is_provisional,0) AS is_provisional,
    CASE WHEN t.drive_speed_kmh IS NOT NULL THEN s.distance_km/t.drive_speed_kmh*3600 END AS estimated_duration_s,
    (SELECT p.longitude FROM drive_routes r JOIN drive_route_points p USING(region_id,project_id,task_id,route_id) WHERE (r.region_id,r.project_id,r.task_id)=(t.region_id,t.project_id,t.task_id) AND p.point_kind='path' ORDER BY r.ordinal,p.ordinal LIMIT 1) AS start_longitude,
    (SELECT p.latitude FROM drive_routes r JOIN drive_route_points p USING(region_id,project_id,task_id,route_id) WHERE (r.region_id,r.project_id,r.task_id)=(t.region_id,t.project_id,t.task_id) AND p.point_kind='path' ORDER BY r.ordinal,p.ordinal LIMIT 1) AS start_latitude,
    (SELECT p.longitude FROM drive_routes r JOIN drive_route_points p USING(region_id,project_id,task_id,route_id) WHERE (r.region_id,r.project_id,r.task_id)=(t.region_id,t.project_id,t.task_id) AND p.point_kind='path' ORDER BY r.ordinal DESC,p.ordinal DESC LIMIT 1) AS end_longitude,
    (SELECT p.latitude FROM drive_routes r JOIN drive_route_points p USING(region_id,project_id,task_id,route_id) WHERE (r.region_id,r.project_id,r.task_id)=(t.region_id,t.project_id,t.task_id) AND p.point_kind='path' ORDER BY r.ordinal DESC,p.ordinal DESC LIMIT 1) AS end_latitude
FROM drive_task_speeds t LEFT JOIN totals s USING(region_id,project_id,task_id)'''


CASE_VIEW = '''CREATE VIEW drive_speed_case_details AS SELECT c.*,t.distance_km,
    t.distance_km/c.speed_kmh*3600 AS estimated_duration_s,t.start_longitude,t.start_latitude,t.end_longitude,t.end_latitude
    FROM drive_speed_cases c JOIN drive_task_details t USING(region_id,project_id,task_id)'''
ROUTE_CASE_VIEW = '''CREATE VIEW drive_route_case_details AS SELECT c.region_id,c.project_id,c.task_id,c.case_id,c.speed_kmh,r.route_id,
    r.distance_km,r.distance_km/c.speed_kmh*3600 AS estimated_duration_s
    FROM drive_speed_cases c JOIN drive_route_details r USING(region_id,project_id,task_id)'''

def initialize_tasks(db):
    db.execute('SELECT sin(0),cos(0),asin(0),sqrt(1),radians(0)')
    db.execute('SAVEPOINT task_store_migration')
    try:
        existing = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='drive_tasks'").fetchone()
        for statement in TABLES:
            db.execute(statement)
        for name in ('drive_route_case_details','drive_speed_case_details','drive_task_details','drive_route_details','drive_task_speeds'):
            db.execute(f'DROP VIEW IF EXISTS {name}')
        if any(row[1]=='drive_speed_kmh' for row in db.execute('PRAGMA table_info(drive_tasks)')):
            for region,project,task,speed,attrs in db.execute('SELECT region_id,project_id,task_id,drive_speed_kmh,attributes FROM drive_tasks').fetchall():
                source=json.loads(attrs)
                if not source.get('speedCases'): source.pop('speedCases',None)
                source['driveSpeedKmh']=speed
                for index,case in enumerate(speed_cases(source)):
                    db.execute('INSERT INTO drive_speed_cases VALUES (?,?,?,?,?,?,?)',(region,project,task,case['id'],index,case['name'],case['speedKmh']))
            db.execute('ALTER TABLE drive_tasks DROP COLUMN drive_speed_kmh')
        for statement in (SPEED_VIEW, ROUTE_VIEW, TASK_VIEW, CASE_VIEW, ROUTE_CASE_VIEW):
            db.execute(statement)
        legacy = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_tasks'").fetchone()
        if legacy:
            if existing:
                raise ValueError('Both legacy and relational task stores exist; refusing to overwrite either')
            for region_id,project_id,payload in db.execute('SELECT region_id,project_id,tasks FROM project_tasks').fetchall():
                write_tasks(db,region_id,project_id,json.loads(payload))
            db.execute('ALTER TABLE project_tasks RENAME TO project_tasks_legacy')
    except BaseException:
        db.execute('ROLLBACK TO task_store_migration')
        raise
    finally:
        db.execute('RELEASE task_store_migration')


def attributes(value, known):
    return json.dumps({key:item for key,item in value.items() if key not in known},ensure_ascii=False)


def write_tasks(db, region_id, project_id, tasks):
    validate_tasks(tasks)
    db.execute('DELETE FROM drive_tasks WHERE region_id=? AND project_id=?',(region_id,project_id))
    for ordinal,task in enumerate(tasks):
        key = (region_id,project_id,task['id'])
        db.execute('INSERT INTO drive_tasks VALUES (?,?,?,?,?,?)',(*key,ordinal,task['name'],attributes(task,{'id','name','driveSpeedKmh','speedCases','routes','driveMetrics'})))
        for index,case in enumerate(speed_cases(task)):
            db.execute('INSERT INTO drive_speed_cases VALUES (?,?,?,?,?,?,?)',(*key,case['id'],index,case['name'],case['speedKmh']))
        for route_ordinal,route in enumerate(task['routes']):
            route_key = (*key,route['id'])
            db.execute('INSERT INTO drive_routes VALUES (?,?,?,?,?,?,?,?,?)',(*route_key,route_ordinal,route['name'],route.get('roadFit'),route.get('fitMessage'),attributes(route,{'id','name','coordinates','waypoints','roadFit','fitMessage','driveMetrics'})))
            for kind,points in (('path',route['coordinates']),('guide',route.get('waypoints',[]))):
                db.executemany('INSERT INTO drive_route_points VALUES (?,?,?,?,?,?,?,?)',((*route_key,kind,index,*point) for index,point in enumerate(points)))


def metrics(row):
    return dict(distanceKm=row['distance_km'],durationSeconds=row['estimated_duration_s'],
                start=[row['start_longitude'],row['start_latitude']] if row['start_longitude'] is not None else None,
                end=[row['end_longitude'],row['end_latitude']] if row['end_longitude'] is not None else None)


def read_tasks(db, region_id, project_id):
    cursor = db.cursor(); cursor.row_factory = sqlite3.Row
    points = {}
    for row in cursor.execute('SELECT * FROM drive_route_points WHERE region_id=? AND project_id=? ORDER BY task_id,route_id,point_kind,ordinal',(region_id,project_id)):
        points.setdefault((row['task_id'],row['route_id'],row['point_kind']),[]).append([row['longitude'],row['latitude']])
    routes = {}; route_metrics = {}
    for row in cursor.execute('SELECT * FROM drive_route_details WHERE region_id=? AND project_id=? ORDER BY task_id,ordinal',(region_id,project_id)):
        route = {**json.loads(row['attributes']),'id':row['route_id'],'name':row['name'],'coordinates':points.get((row['task_id'],row['route_id'],'path'),[])}
        guides = points.get((row['task_id'],row['route_id'],'guide'))
        if guides: route['waypoints'] = guides
        if row['road_fit'] is not None: route['roadFit'] = row['road_fit']
        if row['fit_message'] is not None: route['fitMessage'] = row['fit_message']
        routes.setdefault(row['task_id'],[]).append(route)
        route_metrics.setdefault(row['task_id'],[]).append({'id':row['route_id'],**metrics(row)})
    cases = {};case_metrics = {};case_routes = {}
    for row in cursor.execute('SELECT * FROM drive_route_case_details WHERE region_id=? AND project_id=?',(region_id,project_id)):
        case_routes.setdefault((row['task_id'],row['case_id']),[]).append(dict(id=row['route_id'],durationSeconds=row['estimated_duration_s']))
    for row in cursor.execute('SELECT * FROM drive_speed_case_details WHERE region_id=? AND project_id=? ORDER BY task_id,ordinal',(region_id,project_id)):
        case=dict(id=row['case_id'],name=row['name'],speedKmh=row['speed_kmh']);cases.setdefault(row['task_id'],[]).append(case)
        case_metrics.setdefault(row['task_id'],[]).append({**case,**metrics(row),'routes':case_routes.get((row['task_id'],row['case_id']),[])})
    tasks = []
    for row in cursor.execute('SELECT * FROM drive_task_details WHERE region_id=? AND project_id=? ORDER BY ordinal',(region_id,project_id)):
        task = {**json.loads(row['attributes']),'id':row['task_id'],'name':row['name'],'driveSpeedKmh':row['drive_speed_kmh'],'routes':routes.get(row['task_id'],[]),'speedCases':cases.get(row['task_id'],[])}
        task['driveMetrics'] = {**metrics(row),'speedKmh':row['drive_speed_kmh'],'provisional':bool(row['is_provisional']),'routes':route_metrics.get(row['task_id'],[]),'speedCases':case_metrics.get(row['task_id'],[])}
        tasks.append(task)
    validate_tasks(tasks)
    return tasks
