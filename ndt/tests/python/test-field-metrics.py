"""Explicit measured-carrier columns and backwards-compatible profile upgrades."""
from copy import deepcopy
from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.dm.dm_model import normalize,DEFAULT_PROFILE,validate_profile,COLUMNS

class FieldMetrics(unittest.TestCase):
    def csv(self,value='-82.5',quality='valid'):
        return ('timestamp,latitude,longitude,rat,cell_id,arfcn,measured_rx_dbm,measurement_status\n'
                f'2026-11-01T12:00:00Z,43.7,-79.4,NR,operator-cell,640000,{value},{quality}\n').encode()

    def test_measured_carrier_power_is_preserved_separately_from_rsrp_and_predictions(self):
        row=normalize(self.csv())[0]
        self.assertEqual(row['measured_rx_dbm'],-82.5)
        self.assertEqual(row['measurement_status'],'valid')
        self.assertNotIn('rsrp_dbm',row);self.assertNotIn('predicted_rx_dbm',row)
        self.assertIn('measured_rx_dbm',COLUMNS);self.assertIn('measurement_status',COLUMNS)

    def test_censoring_is_explicit_and_invalid_tokens_are_rejected(self):
        for quality in ['valid','below-floor','above-ceiling','invalid']:
            self.assertEqual(normalize(self.csv(quality=quality))[0]['measurement_status'],quality)
        for value,quality in [('NaN','valid'),('-301','valid'),('-82','guessed')]:
            with self.subTest(value=value,quality=quality),self.assertRaises(ValueError):
                normalize(self.csv(value,quality))

    def test_legacy_profiles_upgrade_without_mutating_the_callers_copy(self):
        old=deepcopy(DEFAULT_PROFILE);old['thresholds'].pop('measured_rx_dbm',None)
        upgraded=validate_profile(old)
        self.assertIn('measured_rx_dbm',upgraded['thresholds'])
        self.assertNotIn('measured_rx_dbm',old['thresholds'])
        bad=deepcopy(old);bad['thresholds']['invented']={'LTE':0,'NR':0}
        with self.assertRaises(ValueError):validate_profile(bad)

if __name__=='__main__':unittest.main()
