"""Metric, provenance, frozen-carrier, receiver, configuration and time compatibility."""
from copy import deepcopy
import hashlib,importlib.util,json
from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.dm.field_measurements import inspect_measurements,descriptor_template
spec=importlib.util.spec_from_file_location('field_inputs',Path(__file__).parents[1]/'fixtures/field-inputs.py')
fixtures=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixtures)

class FieldMeasurements(unittest.TestCase):
    def setUp(self):self.capture,self.prediction,self.descriptor=fixtures.field_inputs()
    def inspect(self):return inspect_measurements(self.capture,self.prediction,json.dumps(self.descriptor))
    def test_declared_compatible_contract_retains_unverified_source_status(self):
        result=self.inspect();self.assertTrue(result['ready'],result['issues'])
        self.assertFalse(result['independentlyVerified']);self.assertEqual(result['mappedCells'],1)
        self.assertEqual(result['descriptor']['measurement']['quantity'],'desired-carrier-local-mean-power')
        self.assertEqual(result['descriptorSha256'],hashlib.sha256(json.dumps(self.descriptor).encode()).hexdigest())
        # Virtual-drive wall clock is unrelated to the actual collection period.
        self.assertLess(self.prediction['rows'][0]['t'],self.capture['start'])

    def test_rsrp_and_rssi_never_become_total_desired_carrier_power(self):
        for quantity,column in [('lte-rsrp','rsrp_dbm'),('nr-ss-rsrp','rsrp_dbm'),('carrier-rssi','measured_rx_dbm')]:
            with self.subTest(quantity=quantity):
                self.descriptor['measurement'].update(quantity=quantity,column=column)
                result=self.inspect();self.assertFalse(result['ready']);self.assertIn('metric',result['issueCodes'])

    def test_synthetic_simulated_unknown_or_unattested_sources_cannot_fit(self):
        for change in ['synthetic','simulated','origin','source','matched']:
            with self.subTest(change=change):
                self.setUp()
                if change in ['synthetic','simulated']:self.capture['kind']=change
                if change=='origin':self.descriptor['provenance']['origin']='analytical-test'
                if change=='source':self.descriptor['configuration']['sourceId']='unreported'
                if change=='matched':self.descriptor['configuration']['matched']=False
                self.assertFalse(self.inspect()['ready'])

    def test_hash_scope_carrier_receiver_height_and_time_mismatches_are_named(self):
        for change,code in [('capture-hash','capture-hash'),('prediction-hash','prediction-hash'),('equipment-hash','equipment-hash'),
                ('geometry','route'),('scope','scope'),('carrier','carrier'),('receiver','receiver'),('height','geometry'),
                ('config-time','configuration-time'),('instrument-time','instrument-time')]:
            with self.subTest(change=change):
                self.setUp()
                if change=='capture-hash':self.descriptor['captureSha256']='0'*64
                if change=='prediction-hash':self.descriptor['predictionSha256']='0'*64
                if change=='equipment-hash':self.descriptor['equipmentSha256']='0'*64
                if change=='geometry':self.descriptor['geometryHash']='0'*64
                if change=='scope':self.capture['scope']['task_id']='another'
                if change=='carrier':self.descriptor['cells'][0]['frequencyMHz']=3700
                if change=='receiver':self.descriptor['measurement']['receiver']={'model':'unsupported'}
                if change=='height':self.descriptor['measurement']['bsHeightM']=30
                if change=='config-time':self.descriptor['configuration']['validUntil']='2026-11-01T01:00:00Z'
                if change=='instrument-time':self.descriptor['instrument']['validUntil']='2026-11-01T01:00:00Z'
                result=self.inspect();self.assertFalse(result['ready']);self.assertIn(code,result['issueCodes'])

    def test_template_never_fabricates_measurement_or_configuration_attestation(self):
        draft=descriptor_template(self.capture,self.prediction)
        self.assertEqual(draft['provenance']['origin'],'unknown')
        self.assertFalse(draft['configuration']['matched'])
        self.assertEqual(draft['instrument']['calibrationRecordId'],'')
        self.assertFalse(inspect_measurements(self.capture,self.prediction,json.dumps(draft))['ready'])

    def test_outer_registry_scope_cannot_relabel_a_frozen_prediction(self):
        self.prediction['context']['scope']['task_id']='another-task'
        result=self.inspect();self.assertFalse(result['ready']);self.assertIn('source-model',result['issueCodes'])

    def test_ideal_dual_collection_is_equivalent_to_the_scalar_total_power_reference(self):
        self.descriptor['measurement']['receiver']=dict(model='ndt.receiver.los-model2.v1',collection='dual-orthogonal',orientation=dict(azimuthDeg=123,tiltDeg=23,rollDeg=-70,slantDeg=45))
        self.assertTrue(self.inspect()['ready'])
        self.descriptor['measurement']['receiver']['collection']='single-linear'
        self.assertIn('receiver',self.inspect()['issueCodes'])

    def test_original_equipment_and_complete_effective_powers_are_required(self):
        for change in ['raw','missing-power','over-budget']:
            with self.subTest(change=change):
                self.setUp();context=self.prediction['context']
                if change=='raw':context['inventorySnapshot']['operatorEquipment']['raw']+=' '
                if change=='missing-power':context['powers'].clear()
                if change=='over-budget':context['powers']['CELL:cell-1']+=10
                self.assertIn('source-model',self.inspect()['issueCodes'])

    def test_duplicate_mapping_unknown_fields_nonfinite_or_boolean_ranges_are_invalid(self):
        for change in ['duplicate','unknown','boolean','range','oversized','json','size']:
            with self.subTest(change=change):
                self.setUp()
                if change=='duplicate':self.descriptor['cells']*=2
                if change=='unknown':self.descriptor['silentlyIgnored']=True
                if change=='boolean':self.descriptor['instrument']['minimumDbm']=True
                if change=='range':self.descriptor['instrument']['minimumDbm']=30
                if change=='oversized':self.descriptor['instrument']['minimumDbm']=10**400
                raw=json.dumps(self.descriptor)
                if change=='json':raw='not json'
                if change=='size':raw=' '*200000
                with self.assertRaises(ValueError):inspect_measurements(self.capture,self.prediction,raw)

if __name__=='__main__':unittest.main()
