import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.extract_bell_outdoor import group_records


def row(licensee='Bell Mobility Inc.', site_type='O', lon='-79.39'):
    return {'licensee_name*':licensee, 'site_type':site_type, 'longitude':lon, 'latitude':'43.7',
            'technology':'LTE', 'tx_frequency':'2140', 'structure_type':'T', 'structure_height':'35', 'tx_ant_height':'30', 'licence_number':'L1',
            'tx_ant_omni_indicator':'D', 'tx_ant_azimuth':'120', 'tx_ant_horiz_beamwidth':'65',
            'location':'1 Main St', 'record_id':'ON123'}


class BellOutdoorTest(unittest.TestCase):
    def test_group_keeps_record_counts_and_height(self):
        sites = group_records([row(), row()])
        self.assertEqual(len(sites), 1)
        props = sites[0]['properties']
        self.assertEqual(props['record_count'], 2)
        self.assertEqual(props['technologies'], {'LTE':2})
        self.assertEqual(props['records'][0]['record_count'], 2)
        self.assertEqual(props['records'][0]['structure_height'], '35')
        self.assertEqual(props['records'][0]['tx_ant_azimuth'], '120')
        self.assertEqual(props['records'][0]['beamwidths'], ['65'])
        self.assertEqual(props['records'][0]['frequencies'], ['2140'])
        self.assertEqual(props['locations'], ['1 Main St'])
        self.assertEqual(props['ised_site_ids'], ['ON123'])

    def test_excludes_indoor_other_licensees_and_out_of_bounds(self):
        self.assertEqual(group_records([row(site_type='I'), row(licensee='TELUS'), row(lon='-80')]), [])


if __name__ == '__main__':
    unittest.main()
