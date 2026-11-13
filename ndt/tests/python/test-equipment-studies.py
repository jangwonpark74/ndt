"""Source-linked site studies keep provenance separate from RF assumptions."""
from contextlib import closing
import copy,hashlib,importlib.util,json,unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('drive_contracts',Path(__file__).with_name('test-drive-integration.py'))
contracts=importlib.util.module_from_spec(spec);spec.loader.exec_module(contracts)
from backend.equipment_studies import validate_equipment_reference,validate_equipment_templates

TEMPLATE=dict(rat='NR',frequencyMHz=3600,bandwidthMHz=100,powerDbm=35,gainDbi=8,lossDb=2,azimuthDeg=0,tiltDeg=6,pattern='element',mode='NLOS',carrier=dict(standard='3gpp-rel18-carrier-subset-v1',band='n78',channel=640000,scsKHz=30))

class EquipmentStudies(unittest.TestCase):
    def setUp(self):
        self.fixture=contracts.DriveIntegration('test_directional_experiment_uses_frozen_template_powers_and_model_version');self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.raw=self.fixture.install_equipment()
        self.reference=dict(revision=1,sha256=hashlib.sha256(self.raw).hexdigest(),cellId='cell-1',linkId='link-1')

    def test_site_link_keeps_exact_source_and_editable_carrier_port_power(self):
        f=self.fixture;f.install_scenario(overrides={'s':{**TEMPLATE,'equipmentSource':self.reference}})
        job=f.store.submit('source-linked',{**f.specification(),'scenario_id':'study'})
        frozen=job['snapshot'];self.assertEqual(frozen['transmitters'][0]['template']['equipmentSource'],self.reference)
        self.assertEqual(frozen['transmitters'][0]['template']['powerDbm'],35)
        self.assertEqual(frozen['inventorySnapshot']['operatorEquipment']['raw'],self.raw.decode('utf-8'))
        f.install_equipment(revision=1);f.store.run_one();result=f.store.get(job['id']);self.assertEqual(result['status'],'completed',result['error'])
        with self.assertRaisesRegex(ValueError,'Equipment source changed'):
            f.store.submit('stale-source',{**f.specification(),'scenario_id':'study'})

    def test_reference_shape_default_assignment_and_wrong_paths_are_rejected(self):
        for value in [{**self.reference,'revision':True},{**self.reference,'sha256':'wrong'},{**self.reference,'cellId':'bad/id'}]:
            with self.subTest(value=value),self.assertRaises(ValueError):validate_equipment_reference(value)
        f=self.fixture
        with closing(contracts.connect(f.planning)) as db:
            with self.assertRaisesRegex(ValueError,'site override'):
                validate_equipment_templates(db,'toronto','p',{**TEMPLATE,'equipmentSource':self.reference},{})
            for ref in [{**self.reference,'cellId':'missing'},{**self.reference,'linkId':'missing'},{**self.reference,'sha256':'0'*64}]:
                with self.subTest(ref=ref),self.assertRaises(ValueError):
                    validate_equipment_templates(db,'toronto','p',TEMPLATE,{'s':{**TEMPLATE,'equipmentSource':ref}})
            with self.assertRaises(ValueError):validate_equipment_templates(db,'toronto','p',TEMPLATE,{'other-site':{**TEMPLATE,'equipmentSource':self.reference}})
            with self.assertRaises(ValueError):validate_equipment_templates(db,'toronto','other-project',TEMPLATE,{'s':{**TEMPLATE,'equipmentSource':self.reference}})

    def test_a_changed_import_blocks_applying_the_old_source_link(self):
        f=self.fixture;f.install_scenario(overrides={'s':{**TEMPLATE,'equipmentSource':self.reference}});f.install_equipment(revision=1)
        with closing(contracts.connect(f.planning)) as db,db:
            with self.assertRaisesRegex(ValueError,'Equipment source changed'):
                contracts.save_scenario(db,'toronto','p',dict(id='study',action='apply',expectedRevision=1))

    def test_linking_source_evidence_alone_is_recorded_without_a_numeric_power_effect(self):
        f=self.fixture;f.install_scenario(overrides={'s':TEMPLATE})
        with closing(contracts.connect(f.planning)) as db,db:contracts.save_scenario(db,'toronto','p',dict(id='study',action='baseline',expectedRevision=1))
        f.install_scenario(revision=1,overrides={'s':{**TEMPLATE,'equipmentSource':self.reference}})
        job=f.store.submit('source-metadata',{**f.specification(),'scenario_id':'study','experiment_type':'scenario-ab'});f.store.run_one();result=f.store.get(job['id'])
        self.assertEqual(result['status'],'completed',result['error']);changes=result['snapshot']['scenarioChanges'];self.assertEqual(len(changes),1)
        self.assertEqual(changes[0]['parameter'],'equipmentSource');self.assertFalse(changes[0]['affectsPrediction'])
        self.assertTrue(all(abs(c['median_delta_db'])<1e-9 for c in result['comparisons']))

if __name__=='__main__':unittest.main()
