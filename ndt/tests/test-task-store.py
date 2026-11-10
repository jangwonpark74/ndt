from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from task_store import connect,initialize_tasks,read_tasks,write_tasks

TASK={'id':'DT-1','name':'Example','driveSpeedKmh':30,'note':'Keep this attribute','routes':[
    {'id':'a','name':'First','coordinates':[[0,0],[.01,0]],'waypoints':[[0,0],[.01,0]],'roadFit':'fitted'},
    {'id':'b','name':'Second','coordinates':[[10,0],[10.01,0]],'fitMessage':'Original path','note':'Keep route attribute'}]}

class TaskStoreTests(unittest.TestCase):
    def database(self):
        db=connect(':memory:');db.execute('CREATE TABLE regions(id TEXT PRIMARY KEY)');db.execute("INSERT INTO regions VALUES ('toronto')");db.commit();return db

    def test_migration_is_lossless_idempotent_and_does_not_restore_deleted_tasks(self):
        with closing(self.database()) as db:
            db.execute('CREATE TABLE project_tasks(region_id TEXT,project_id TEXT,tasks TEXT)')
            payload=json.dumps([TASK]);db.execute('INSERT INTO project_tasks VALUES (?,?,?)',('toronto','p',payload));db.commit()
            initialize_tasks(db)
            self.assertEqual(db.execute('SELECT tasks FROM project_tasks_legacy').fetchone()[0],payload)
            loaded=read_tasks(db,'toronto','p')
            self.assertEqual({k:v for k,v in loaded[0].items() if k not in ('driveMetrics','speedCases')},TASK)
            self.assertEqual(db.execute('SELECT count(*) FROM drive_routes').fetchone()[0],2)
            self.assertEqual(db.execute('SELECT count(*) FROM drive_route_points').fetchone()[0],6)
            initialize_tasks(db)
            self.assertEqual(len(read_tasks(db,'toronto','p')),1)
            with db:write_tasks(db,'toronto','p',[])
            initialize_tasks(db)
            self.assertEqual(read_tasks(db,'toronto','p'),[])
            self.assertEqual(db.execute('SELECT count(*) FROM drive_route_points').fetchone()[0],0)
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_invalid_migration_rolls_back_and_preserves_original_json(self):
        with closing(self.database()) as db:
            db.execute('CREATE TABLE project_tasks(region_id TEXT,project_id TEXT,tasks TEXT)')
            payload=json.dumps([{**TASK,'driveSpeedKmh':0}]);db.execute('INSERT INTO project_tasks VALUES (?,?,?)',('toronto','p',payload));db.commit()
            with self.assertRaises(ValueError):initialize_tasks(db)
            self.assertEqual(db.execute('SELECT tasks FROM project_tasks').fetchone()[0],payload)
            self.assertIsNone(db.execute("SELECT 1 FROM sqlite_master WHERE name='drive_tasks'").fetchone())

    def test_sql_views_compute_distance_duration_gps_and_follow_database_changes(self):
        with closing(self.database()) as db:
            initialize_tasks(db)
            with db:write_tasks(db,'toronto','p',[TASK])
            result=read_tasks(db,'toronto','p')[0]['driveMetrics']
            self.assertAlmostEqual(result['distanceKm'],2.22389853289,places=9)
            self.assertAlmostEqual(result['durationSeconds'],266.867823947,places=8)
            self.assertEqual(result['start'],[0,0]);self.assertEqual(result['end'],[10.01,0]);self.assertTrue(result['provisional'])
            with db:db.execute("UPDATE drive_speed_cases SET speed_kmh=60 WHERE project_id='p'")
            self.assertAlmostEqual(read_tasks(db,'toronto','p')[0]['driveMetrics']['durationSeconds'],result['durationSeconds']/2)
            with db:db.execute("UPDATE drive_route_points SET longitude=.02 WHERE route_id='a' AND point_kind='path' AND ordinal=1")
            self.assertAlmostEqual(db.execute("SELECT distance_km FROM drive_route_details WHERE route_id='a'").fetchone()[0],2.22389853289,places=9)
            with db:write_tasks(db,'toronto','empty',[{'id':'e','name':'Empty','routes':[]}])
            empty=read_tasks(db,'toronto','empty')[0]['driveMetrics'];self.assertIsNone(empty['distanceKm']);self.assertIsNone(empty['durationSeconds']);self.assertIsNone(empty['start'])

    def test_constraints_and_failed_write_preserve_saved_data(self):
        with closing(self.database()) as db:
            initialize_tasks(db)
            with db:write_tasks(db,'toronto','p',[TASK])
            with self.assertRaises(ValueError), db:write_tasks(db,'toronto','p',[{**TASK,'driveSpeedKmh':True}])
            with self.assertRaises(sqlite3.IntegrityError), db:db.execute("UPDATE drive_route_points SET latitude=100")
            self.assertEqual(read_tasks(db,'toronto','p')[0]['name'],TASK['name'])
            with self.assertRaises(sqlite3.IntegrityError), db:db.execute("INSERT INTO drive_route_points VALUES ('toronto','missing','none','none','path',0,0,0)")

    def test_multiple_speed_cases_share_geometry_and_have_sql_comparison_rows(self):
        with closing(self.database()) as db:
            initialize_tasks(db)
            task={**TASK,'driveSpeedKmh':20,'speedCases':[dict(id=f'C-{speed}',name=f'{speed} km/h',speedKmh=speed) for speed in (20,40,60)]}
            with db:write_tasks(db,'toronto','p',[task])
            self.assertEqual(db.execute('SELECT count(*) FROM drive_routes').fetchone()[0],2)
            self.assertEqual(db.execute('SELECT count(*) FROM drive_route_points').fetchone()[0],6)
            self.assertEqual(db.execute('SELECT count(*) FROM drive_speed_cases').fetchone()[0],3)
            self.assertEqual(db.execute('SELECT count(*) FROM drive_route_case_details').fetchone()[0],6)
            cases=read_tasks(db,'toronto','p')[0]['driveMetrics']['speedCases']
            self.assertAlmostEqual(cases[0]['durationSeconds']/3,cases[2]['durationSeconds'])
            self.assertEqual([case['speedKmh'] for case in cases],[20,40,60])
            with self.assertRaises(ValueError),db:write_tasks(db,'toronto','p',[{**task,'speedCases':[task['speedCases'][0]]*2}])
            self.assertEqual(db.execute('SELECT count(*) FROM drive_speed_cases').fetchone()[0],3)

    def test_single_speed_relational_upgrade_preserves_speeds(self):
        with closing(self.database()) as db:
            db.execute('CREATE TABLE drive_tasks(region_id TEXT,project_id TEXT,task_id TEXT,ordinal INTEGER,name TEXT,drive_speed_kmh REAL,attributes TEXT,PRIMARY KEY(region_id,project_id,task_id))')
            db.execute('INSERT INTO drive_tasks VALUES (?,?,?,?,?,?,?)',('toronto','p','old',0,'Old task',45,'{}'));db.commit()
            initialize_tasks(db)
            task=read_tasks(db,'toronto','p')[0]
            self.assertEqual(task['speedCases'][0]['speedKmh'],45)
            self.assertEqual(task['driveSpeedKmh'],45)
            initialize_tasks(db)
            self.assertEqual(db.execute('SELECT count(*) FROM drive_speed_cases').fetchone()[0],1)

    def test_legacy_single_speed_clients_update_the_primary_case(self):
        with closing(self.database()) as db:
            initialize_tasks(db)
            with db:write_tasks(db,'toronto','p',[{**TASK,'driveSpeedKmh':45,'speedCases':[]}])
            accepted=read_tasks(db,'toronto','p')[0]
            self.assertEqual(accepted['speedCases'][0]['speedKmh'],45)
            accepted['driveSpeedKmh']=55
            with db:write_tasks(db,'toronto','p',[accepted])
            self.assertEqual(read_tasks(db,'toronto','p')[0]['speedCases'][0]['speedKmh'],55)

if __name__=='__main__':unittest.main()
