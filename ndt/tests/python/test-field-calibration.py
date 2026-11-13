"""Independent power/bin arithmetic and leakage-resistant calibration oracles."""
from copy import deepcopy
import math
from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.dm.field_calibration import fit_holdout

def sample(site,t,bin_index,residual,frequency=3600,measured=-80):
    return dict(siteId=site,t=t,chainageM=bin_index*20+1,rat='NR',band='n78',
                frequencyMHz=frequency,bandwidthMHz=100,environment='LOS',cellId='cell-'+site,
                measuredDbm=measured,predictedDbm=measured-residual)

def data():
    return [sample(site,t+i,i,residual) for site,t,residual in [('a',0,4),('b',100,2),('c',2000,7),('d',2100,5)] for i in range(30)]

class FieldCalibration(unittest.TestCase):
    def fit(self,rows,**changes):
        return fit_holdout(rows,cutoff_t=1000,heldout_sites=['c','d'],gap_ms=0,**changes)

    def test_only_earlier_disjoint_sites_train_the_offset(self):
        rows=data();original=deepcopy(rows);result=self.fit(rows)
        self.assertEqual(result['status'],'diagnostic-complete')
        self.assertEqual(result['offsetDb'],3)
        self.assertEqual(result['training']['bins'],60);self.assertEqual(result['training']['sites'],2)
        self.assertEqual(result['holdout']['bins'],60);self.assertEqual(result['holdout']['sites'],2)
        self.assertAlmostEqual(result['holdout']['raw']['rmseDb'],math.sqrt(37))
        self.assertAlmostEqual(result['holdout']['adjusted']['rmseDb'],math.sqrt(10))
        self.assertEqual(result['holdout']['raw']['biasDb'],6)
        self.assertEqual(result['holdout']['adjusted']['biasDb'],3)
        self.assertEqual(rows,original)
        # A disastrous holdout changes scores, never the trained offset.
        altered=deepcopy(rows)
        for row in altered:
            if row['siteId'] in ['c','d']:row['measuredDbm']+=40
        self.assertEqual(self.fit(altered)['offsetDb'],3)

    def test_power_averaging_precedes_db_residual_and_duplicate_samples_do_not_add_bins(self):
        rows=data();rows[0].update(measuredDbm=-80,predictedDbm=-84)
        second={**rows[0],'t':50,'measuredDbm':-70,'predictedDbm':-84}
        result=self.fit(rows+[second]);first=next(b for b in result['bins'] if b['siteId']=='a' and b['chainageM']==0)
        self.assertAlmostEqual(first['measuredDbm'],10*math.log10((10**-8+10**-7)/2),places=12)
        self.assertEqual(first['samples'],2);self.assertEqual(result['training']['bins'],60)

    def test_site_time_quarantine_and_gap_are_reported(self):
        extra=[sample('c',100,99,100),sample('a',2000,99,-100),sample('a',995,98,50)]
        result=fit_holdout(data()+extra,cutoff_t=1000,heldout_sites=['c','d'],gap_ms=10)
        self.assertEqual(result['offsetDb'],3)
        self.assertEqual(result['quarantined'],3)
        self.assertEqual(result['quarantineReasons'],{'heldout-site-before-cutoff':1,'training-site-after-cutoff':1,'time-gap':1})

    def test_unseen_carriers_are_not_scored_with_a_trained_offset(self):
        rows=data()+[sample('e',2500+i,i,40,frequency=3700) for i in range(30)]
        result=self.fit_with_extra_site(rows)
        self.assertEqual(result['offsetDb'],3);self.assertEqual(result['holdout']['bins'],60)
        self.assertEqual(result['unscoredHoldoutBins'],30)
        self.assertEqual(result['holdout']['raw']['biasDb'],6)
        self.assertTrue(any(g['frequencyMHz']==3700 and g['adjusted'] is None for g in result['byCarrier']))

    def fit_with_extra_site(self,rows):
        return fit_holdout(rows,cutoff_t=1000,heldout_sites=['c','d','e'],gap_ms=0)

    def test_sparse_or_single_site_data_cannot_be_called_calibrated(self):
        result=self.fit([r for r in data() if r['siteId']!='b'])
        self.assertEqual(result['status'],'insufficient-training');self.assertIsNone(result['offsetDb'])
        result=self.fit([r for r in data() if r['siteId']!='d'])
        self.assertEqual(result['status'],'insufficient-holdout')
        self.assertEqual(result['offsetDb'],3)

    def test_invalid_pairs_and_split_inputs_fail_instead_of_silently_fitting(self):
        for change in [dict(predictedDbm=math.nan),dict(predictedDbm=10**400),dict(measuredDbm=True),dict(chainageM=-1),dict(t=1.5)]:
            with self.subTest(change=change),self.assertRaises(ValueError):self.fit([data()[0]|change])
        with self.assertRaises(ValueError):fit_holdout(data(),cutoff_t=1000,heldout_sites=[],gap_ms=0)
        with self.assertRaises(ValueError):fit_holdout(data(),cutoff_t=1000,heldout_sites=['c','c'],gap_ms=0)

if __name__=='__main__':unittest.main()
