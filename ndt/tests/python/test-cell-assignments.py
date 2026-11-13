"""Source cells govern modeled ports; all conducted allocations share a radio budget."""
from contextlib import closing
from copy import deepcopy
import hashlib,http.client,importlib.util,json,math,threading,unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('drive_contracts',Path(__file__).with_name('test-drive-integration.py'))
contracts=importlib.util.module_from_spec(spec);spec.loader.exec_module(contracts)
from backend.cell_assignments import resolve_cell_assignments,build_cell_transmitters,cell_eirp,validate_cell_power_change

NR=dict(rat='NR',frequencyMHz=3600,bandwidthMHz=100,powerDbm=30,gainDbi=8,lossDb=2,azimuthDeg=180,tiltDeg=6,pattern='element',mode='NLOS',carrier=dict(standard='3gpp-rel18-carrier-subset-v1',band='n78',channel=640000,scsKHz=30))
LTE={**NR,'rat':'LTE','frequencyMHz':2130,'bandwidthMHz':20,'carrier':dict(standard='3gpp-rel18-carrier-subset-v1',band='B4',channel=2150,scsKHz=15)}

class CellAssignments(unittest.TestCase):
    def setUp(self):
        self.f=contracts.DriveIntegration('test_selected_scenario_and_complete_source_inputs_are_frozen');self.f.setUp();self.addCleanup(self.f.doCleanups)
        data=json.loads((Path(__file__).parents[1]/'fixtures/equipment-example.json').read_text(encoding='utf-8'));data['sites'][0]['inventorySiteId']='s';data['cells'][0]['frequencyMHz']=3600
        for original,new in [('radio-port-1','radio-port-2'),('antenna-port-1','antenna-port-2')]:
            port=deepcopy(next(p for p in data['ports'] if p['id']==original));port.update(id=new,name=new,sourceRecordId=new);data['ports'].append(port)
        data['links'].append({**data['links'][0],'id':'link-2','radioPortId':'radio-port-2','antennaPortId':'antenna-port-2'})
        data['cells'].append({**data['cells'][0],'id':'cell-2','rat':'LTE','cellIdentity':'test-eci-2','frequencyMHz':2130,'bandwidthMHz':20})
        data['links'].append({**data['links'][0],'id':'link-3','cellId':'cell-2'})
        self.raw=b'\xef\xbb\xbf'+json.dumps(data).encode();self.sha=hashlib.sha256(self.raw).hexdigest()
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.import_inventory(db,'toronto','p',self.raw,0)
        def port(template,cell,link):return {**deepcopy(template),'equipmentSource':dict(revision=1,sha256=self.sha,cellId=cell,linkId=link)}
        self.cells=[dict(cellId='cell-1',ports=[port(NR,'cell-1','link-1'),port(NR,'cell-1','link-2')]),dict(cellId='cell-2',ports=[port(LTE,'cell-2','link-3')])]
        self.budgets={'radio-1':35}

    def resolve(self,cells=None,budgets=None,**kwargs):
        with closing(contracts.connect(self.f.planning)) as db:
            return resolve_cell_assignments(db,'toronto','p',self.cells if cells is None else cells,self.budgets if budgets is None else budgets,**kwargs)

    def install(self,revision=0,cells=None,budgets=None):
        body=dict(id='cells',name='Source cells',action='save',expectedRevision=revision,template=NR,overrides={},assignmentMode='cells',cells=self.cells if cells is None else cells,radioBudgets=self.budgets if budgets is None else budgets)
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.save_scenario(db,'toronto','p',body)
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.save_scenario(db,'toronto','p',dict(id='cells',action='apply',expectedRevision=revision+1))

    def execution(self,**fields):return {**self.f.specification(),'scenario_id':'cells','transmitter_id':'CELL:cell-1','experiment_type':'virtual-drive',**fields}

    def test_imported_cells_execute_without_the_legacy_bell_membership_fallback(self):
        self.install()
        with closing(contracts.connect(self.f.planning)) as db,db:db.execute("UPDATE project_sites SET site_ids='[]'")
        job=self.f.store.submit('cells-run',self.execution())
        self.assertEqual(job['snapshot']['predictionModel'],'uma-source-cells-fixed-heights-v4')
        self.assertEqual(len(job['snapshot']['transmitters']),2)
        self.assertEqual(job['snapshot']['inventorySnapshot']['sourceSites'][0]['properties']['site_id'],'s')
        self.assertEqual(job['snapshot']['inventorySnapshot']['operatorEquipment']['raw'],self.raw.decode('utf-8'))
        self.f.store.run_one();result=self.f.store.get(job['id']);self.assertEqual(result['status'],'completed',result['error'])
        run=contracts.get_test(self.f.tests,result['runs'][0]['test_id']);row=run['rows'][0]
        from backend.dm.antenna import antenna_attenuation
        from backend.dm.integration import distance
        from backend.dm.simulation import path_loss
        d=distance([-79.4,43.7],[-79.4,43.701]);e=math.degrees(math.atan2(-23.5,d))
        expected=36+10*math.log10(2)-path_loss(d,3600,'NLOS')-antenna_attenuation(NR,0,e)
        self.assertAlmostEqual(row['predicted_rx_dbm'],expected,places=8);self.assertEqual(row['cell_id'],'PLAN:CELL:cell-1')
        lte=self.f.store.submit('cells-lte',self.execution(rat='LTE',transmitter_id='CELL:cell-2'));self.f.store.run_one();lte=self.f.store.get(lte['id'])
        self.assertEqual(lte['status'],'completed',lte['error']);run=contracts.get_test(self.f.tests,lte['runs'][0]['test_id']);self.assertEqual(run['rows'][0]['cell_id'],'PLAN:CELL:cell-2')

    def test_parameter_b_preserves_port_weights_and_enforces_the_frozen_radio_budget(self):
        self.install();bound=36+10*math.log10(2)
        with self.assertRaisesRegex(ValueError,'budget'):self.f.store.submit('over-budget',self.execution(experiment_type='parameter-ab',power_b_dbm=bound+1))
        job=self.f.store.submit('power-pair',self.execution(experiment_type='parameter-ab',power_b_dbm=bound+.2));self.f.store.run_one();result=self.f.store.get(job['id'])
        self.assertEqual(result['status'],'completed',result['error'])
        self.assertTrue(all(abs(pair['median_delta_db']-.2)<1e-8 for pair in result['comparisons']))
        a,b=[contracts.get_test(self.f.tests,run['test_id']) for run in result['runs'][:2]]
        self.assertEqual(a['context']['transmitters'],b['context']['transmitters']);self.assertAlmostEqual(b['context']['powers']['CELL:cell-1']-a['context']['powers']['CELL:cell-1'],.2)

    def test_queued_cells_keep_original_sources_and_reject_older_model_reinterpretation(self):
        self.install();job=self.f.store.submit('frozen-cells',self.execution())
        changed=deepcopy(self.cells);changed[0]['ports'][0]['tiltDeg']=45;self.install(revision=1,cells=changed)
        self.f.install_equipment(revision=1);self.f.store.run_one();result=self.f.store.get(job['id'])
        self.assertEqual(result['status'],'completed',result['error']);run=contracts.get_test(self.f.tests,result['runs'][0]['test_id'])
        self.assertEqual(run['context']['transmitters'][0]['ports'][0]['template']['tiltDeg'],6)
        self.assertEqual(run['context']['inventorySnapshot']['operatorEquipment']['raw'],self.raw.decode('utf-8'))
        from backend.dm.simulation import model_for
        for model in ['uma-mean-power-fixed-heights-v1','uma-element-fixed-heights-v2','uma-uniform-panel-fixed-heights-v3']:
            snapshot=deepcopy(job['snapshot']);snapshot['predictionModel']=model
            if model=='uma-mean-power-fixed-heights-v1':snapshot.pop('radioScenario')
            with self.subTest(model=model),self.assertRaisesRegex(ValueError,'model'):model_for(snapshot)

    def test_a_cell_is_unavailable_if_one_assigned_port_is_inside_the_far_field_boundary(self):
        cells=deepcopy(self.cells);cells[0]['ports'][0].update(pattern='array',array=dict(rows=1,columns=64,verticalSpacing=.5,horizontalSpacing=.5,steerAzimuthDeg=0,steerDowntiltDeg=0))
        self.install(cells=cells);job=self.f.store.submit('port-domain',self.execution());self.f.store.run_one();result=self.f.store.get(job['id'])
        self.assertEqual(result['status'],'completed',result['error']);run=contracts.get_test(self.f.tests,result['runs'][0]['test_id'])
        self.assertNotIn('predicted_rx_dbm',run['rows'][0]);self.assertIn('all port far-field',run['rows'][0]['event']);self.assertIn('predicted_rx_dbm',run['rows'][-1])

    def test_work_bound_and_queued_budget_corruption_fail_before_members_are_published(self):
        self.install()
        with patch('backend.dm.experiments.MAX_PORT_EVALUATIONS',1),self.assertRaisesRegex(ValueError,'port-work limit'):self.f.store.submit('too-large',self.execution())
        bound=36+10*math.log10(2);job=self.f.store.submit('tampered-power',self.execution(experiment_type='parameter-ab',power_b_dbm=bound))
        from backend.dm.dm_model import connection
        with connection(self.f.tests) as db:db.execute('UPDATE experiments SET spec=? WHERE id=?',(json.dumps({**job['spec'],'power_b_dbm':bound+1}),job['id']))
        self.f.store.run_one();result=self.f.store.get(job['id']);self.assertEqual(result['status'],'failed');self.assertIn('budget',result['error']);self.assertEqual(result['runs'],[])

    def test_saved_port_changes_and_budget_only_changes_have_distinct_prediction_effects(self):
        self.install()
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.save_scenario(db,'toronto','p',dict(id='cells',action='baseline',expectedRevision=1))
        changed=deepcopy(self.cells);changed[0]['ports'][0]['azimuthDeg']=0;self.install(revision=1,cells=changed)
        job=self.f.store.submit('port-rotation',self.execution(experiment_type='scenario-ab'));self.f.store.run_one();result=self.f.store.get(job['id'])
        self.assertEqual(result['status'],'completed',result['error']);changes=result['snapshot']['scenarioChanges']
        self.assertEqual(len(changes),1);self.assertEqual(changes[0]['linkId'],'link-1');self.assertEqual(changes[0]['parameter'],'azimuthDeg');self.assertTrue(changes[0]['affectsPrediction'])
        a,b=[contracts.get_test(self.f.tests,r['test_id']) for r in result['runs'][:2]];self.assertLess(b['rows'][0]['predicted_rx_dbm'],a['rows'][0]['predicted_rx_dbm']-2)
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.save_scenario(db,'toronto','p',dict(id='cells',action='baseline',expectedRevision=2))
        self.install(revision=2,cells=changed,budgets={'radio-1':36})
        job=self.f.store.submit('budget-metadata',self.execution(experiment_type='scenario-ab'));self.f.store.run_one();result=self.f.store.get(job['id'])
        self.assertEqual(result['status'],'completed',result['error']);self.assertTrue(all(abs(c['median_delta_db'])<1e-9 for c in result['comparisons']))
        self.assertEqual([c['parameter'] for c in result['snapshot']['scenarioChanges']],['radioBudgetDbm']);self.assertFalse(result['snapshot']['scenarioChanges'][0]['affectsPrediction'])

    def test_source_cells_and_assumed_sites_can_be_compared_without_reinterpreting_old_jobs(self):
        def legacy(revision):
            with closing(contracts.connect(self.f.planning)) as db,db:contracts.save_scenario(db,'toronto','p',dict(id='cells',name='Assumed sites',action='save',expectedRevision=revision,template=NR,overrides={}))
            with closing(contracts.connect(self.f.planning)) as db,db:contracts.save_scenario(db,'toronto','p',dict(id='cells',action='apply',expectedRevision=revision+1))
        legacy(0)
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.save_scenario(db,'toronto','p',dict(id='cells',action='baseline',expectedRevision=1))
        self.install(revision=1)
        job=self.f.store.submit('sites-to-cells',self.execution(experiment_type='scenario-ab'));self.f.store.run_one();result=self.f.store.get(job['id'])
        self.assertEqual(result['status'],'completed',result['error']);self.assertTrue(all(abs(c['median_delta_db']-10*math.log10(2))<1e-8 for c in result['comparisons']))
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.save_scenario(db,'toronto','p',dict(id='cells',action='baseline',expectedRevision=2))
        legacy(2)
        job=self.f.store.submit('cells-to-sites',self.execution(experiment_type='scenario-ab',transmitter_id='s:3500'));self.f.store.run_one();result=self.f.store.get(job['id'])
        self.assertEqual(result['status'],'completed',result['error']);self.assertTrue(all(abs(c['median_delta_db']+10*math.log10(2))<1e-8 for c in result['comparisons']))

    def test_explicit_source_cells_can_plan_reservations_without_inventing_legacy_radio_data(self):
        with closing(contracts.connect(self.f.planning)) as db,db:
            db.execute('INSERT INTO regions VALUES (?,?,?)',('new-york',json.dumps(dict(id='new-york',name='New York',network='nyc',projects=[dict(id='p',name='Reservation study',center=[-73.98,40.76])])),'ny-source'))
            feature=dict(type='Feature',geometry=dict(type='Point',coordinates=[-73.98,40.761]),properties=dict(id='pole',franchisee='Verizon',status='Proposed',records=[]))
            db.execute('INSERT INTO network_sites VALUES (?,?,?,?,?)',('new-york','verizon-poles.geojson','pole',0,json.dumps(feature)))
            task=deepcopy(contracts.TASK);task['routes'][0]['coordinates']=[[-73.98,40.76],[-73.979,40.76],[-73.978,40.76]];contracts.write_tasks(db,'new-york','p',[task])
        data=json.loads(self.raw.decode('utf-8-sig'));data['sites'][0]['inventorySiteId']='pole';raw=json.dumps(data).encode();cells=deepcopy(self.cells)
        for cell in cells:
            for port in cell['ports']:port['equipmentSource']['sha256']=hashlib.sha256(raw).hexdigest()
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.import_inventory(db,'new-york','p',raw,0)
        for action,revision in [('save',0),('apply',1)]:
            with closing(contracts.connect(self.f.planning)) as db,db:contracts.save_scenario(db,'new-york','p',dict(id='ny-cells',name='Proposed cell study',action=action,expectedRevision=revision,template=NR,overrides={},assignmentMode='cells',cells=cells,radioBudgets=self.budgets))
        entry=next(t for t in contracts.catalog(self.f.planning)['tasks'] if t['region_id']=='new-york');self.assertEqual(entry['transmitters'],[])
        job=self.f.store.submit('ny-source-cells',{**self.execution(),'region_id':'new-york','context_hash':entry['context_hash'],'scenario_id':'ny-cells'})
        self.assertEqual(job['snapshot']['inventorySnapshot']['sourceSiteKind'],'Reservation inventory location')
        self.assertEqual(job['snapshot']['inventorySnapshot']['sourceSites'][0]['properties']['status'],'Proposed')
        self.f.store.run_one();result=self.f.store.get(job['id']);self.assertEqual(result['status'],'completed',result['error'])

    def test_two_rats_and_multiple_ports_at_one_site_do_not_become_one_site_template(self):
        resolved=self.resolve(current=True,qualified=True)
        with closing(contracts.connect(self.f.planning)) as db:features=[json.loads(r[0]) for r in db.execute('SELECT feature FROM network_sites')]
        rows=build_cell_transmitters(resolved,features)
        self.assertEqual([t['id'] for t in rows],['CELL:cell-1','CELL:cell-2'])
        self.assertEqual([len(t['ports']) for t in rows],[2,1]);self.assertEqual({t['rat'] for t in rows},{'LTE','NR'})
        self.assertAlmostEqual(cell_eirp(rows[0]),36+10*math.log10(2));self.assertAlmostEqual(cell_eirp(rows[1]),36)
        self.assertAlmostEqual(resolved['radioPowerDbm']['radio-1'],30+10*math.log10(3))
        self.assertEqual(rows[0]['ports'][1]['radioPortId'],'radio-port-2')
        self.assertEqual(resolved['inventory']['raw'],self.raw.decode('utf-8'))

    def test_power_changes_check_every_rat_and_preserve_port_power_ratios(self):
        with closing(contracts.connect(self.f.planning)) as db:features=[json.loads(r[0]) for r in db.execute('SELECT feature FROM network_sites')]
        rows=build_cell_transmitters(self.resolve(qualified=True),features);before=deepcopy(rows);bound=cell_eirp(rows[0])
        validate_cell_power_change(rows,self.budgets,'CELL:cell-1',bound+.2)
        with self.assertRaisesRegex(ValueError,'budget'):validate_cell_power_change(rows,self.budgets,'CELL:cell-1',bound+1)
        self.assertEqual(rows,before,'B qualification must not mutate frozen A inputs')
        with self.assertRaisesRegex(ValueError,'budget'):self.resolve(budgets={'radio-1':34})
        self.resolve(budgets={'radio-1':30+10*math.log10(3)})

    def test_unknown_budget_is_explicit_and_cannot_qualify_for_execution(self):
        self.resolve(budgets={'radio-1':None})
        with self.assertRaisesRegex(ValueError,'budget'):self.resolve(budgets={'radio-1':None},qualified=True)
        for budgets in [{},{'radio-1':True},{'radio-1':float('nan')},{'radio-1':10**400},{'radio-1':35,'other':40}]:
            with self.subTest(budgets=budgets),self.assertRaises(ValueError):self.resolve(budgets=budgets)

    def test_duplicate_wrong_source_and_inconsistent_cell_carriers_fail(self):
        variants=[]
        value=deepcopy(self.cells);value.append(deepcopy(value[0]));variants.append(value)
        value=deepcopy(self.cells);value[0]['ports'].append(deepcopy(value[0]['ports'][0]));variants.append(value)
        value=deepcopy(self.cells);value[0]['ports'][0]['equipmentSource']['linkId']='link-3';variants.append(value)
        value=deepcopy(self.cells);value[0]['ports'][1]['frequencyMHz']=3600.015;variants.append(value)
        value=deepcopy(self.cells);value[0]['ports'][0]['equipmentSource']['sha256']='0'*64;variants.append(value)
        value=deepcopy(self.cells);value[0]['ports'][0]['equipmentSource']['revision']=2;variants.append(value)
        for cells in variants:
            with self.subTest(cells=cells),self.assertRaises(ValueError):self.resolve(cells=cells)

    def test_same_physical_port_cannot_send_overlapping_cells(self):
        value=deepcopy(self.cells);value[1]['ports'][0].update({k:deepcopy(NR[k]) for k in ('rat','frequencyMHz','bandwidthMHz','carrier')})
        # First reject the changed source RAT independently, then test a same-RAT imported cell.
        with self.assertRaisesRegex(ValueError,'RAT'):self.resolve(cells=value)
        with closing(contracts.connect(self.f.planning)) as db,db:
            data=json.loads(self.raw.decode('utf-8-sig'));data['cells'][1].update(rat='NR',frequencyMHz=3600,bandwidthMHz=100)
            raw=json.dumps(data).encode();contracts.import_inventory(db,'toronto','p',raw,1)
        for cell in value:
            for port in cell['ports']:port['equipmentSource'].update(revision=2,sha256=hashlib.sha256(raw).hexdigest())
        with self.assertRaisesRegex(ValueError,'overlap'):self.resolve(cells=value)

    def test_old_sources_can_be_saved_but_do_not_qualify_after_a_new_import(self):
        self.f.install_equipment(revision=1)
        self.resolve()
        with self.assertRaisesRegex(ValueError,'Equipment source changed'):self.resolve(current=True)

    def test_scenario_versions_retain_cell_mode_paths_and_budgets(self):
        body=dict(id='cells',name='Source cells',action='save',expectedRevision=0,template=NR,overrides={},assignmentMode='cells',cells=self.cells,radioBudgets=self.budgets)
        with closing(contracts.connect(self.f.planning)) as db,db:accepted=contracts.save_scenario(db,'toronto','p',body)
        version=accepted['versions'][0]
        self.assertEqual(version['assignmentMode'],'cells');self.assertEqual(version['cells'],self.cells);self.assertEqual(version['radioBudgets'],self.budgets)
        self.assertEqual(version['modelVersion'],'uma-source-cells-v3')
        with closing(contracts.connect(self.f.planning)) as db,db:contracts.save_scenario(db,'toronto','p',dict(id='cells',action='apply',expectedRevision=1))
        self.f.install_equipment(revision=1)
        with closing(contracts.connect(self.f.planning)) as db,db:
            with self.assertRaisesRegex(ValueError,'Equipment source changed'):contracts.save_scenario(db,'toronto','p',dict(id='cells',action='baseline',expectedRevision=1))

    def test_http_source_configuration_has_a_bounded_larger_envelope_than_legacy_studies(self):
        from backend import server
        httpd=server.ViewerHTTPServer(('127.0.0.1',0),server.handler_for(self.f.planning));thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
        def send(body):
            raw=json.dumps(body).encode()+b' '*1000100
            with closing(http.client.HTTPConnection('127.0.0.1',httpd.server_port,timeout=10)) as client:
                client.request('PUT','/api/regions/toronto/projects/p/radio-scenarios',raw,{'Content-Type':'application/json'})
                response=client.getresponse();return response.status,json.loads(response.read())
        base=dict(name='Large source study',action='save',expectedRevision=0,template=NR,overrides={})
        try:
            status,value=send({**base,'id':'large-cells','assignmentMode':'cells','cells':self.cells,'radioBudgets':self.budgets});self.assertEqual(status,200,value)
            status,value=send({**base,'id':'large-sites'});self.assertEqual(status,400);self.assertIn('1 MB',value['error'])
        finally:httpd.shutdown();httpd.server_close();thread.join(timeout=5)

    def test_source_cell_mode_cannot_silently_mix_site_fallbacks_or_ignore_bad_modes(self):
        base=dict(id='cells',name='Source cells',action='save',expectedRevision=0,template=NR,overrides={},assignmentMode='cells',cells=self.cells,radioBudgets=self.budgets)
        for change in [dict(assignmentMode='future-model'),dict(overrides={'s':NR}),dict(radioBudgets={'radio-1':34})]:
            with self.subTest(change=change),closing(contracts.connect(self.f.planning)) as db,db:
                with self.assertRaises(ValueError):contracts.save_scenario(db,'toronto','p',{**base,**change})

if __name__=='__main__':unittest.main()
