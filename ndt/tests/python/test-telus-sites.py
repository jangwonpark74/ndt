import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.extract_telus_sites import group_records


def row(licensee, lon='-79.39', lat='43.70', technology='LTE'):
    return {'licensee_name*':licensee, 'longitude':lon, 'latitude':lat, 'technology':technology,
            'structure_height':'12', 'record_id':'123'}


class TelusSitesTest(unittest.TestCase):
    def test_groups_all_records_at_the_same_coordinate(self):
        first = row('TELUS Communications Inc.')
        first.update({'cell_id':'302220-1-2', 'tx_ant_omni_indicator':'N', 'tx_ant_azimuth':'0'})
        features = group_records([first, row('TELUS Communications Inc.', technology='5GNR')])
        self.assertEqual(len(features), 1)
        self.assertEqual(features[0]['properties']['record_count'], 2)
        self.assertEqual(features[0]['properties']['technologies'], {'5GNR':1, 'LTE':1})
        self.assertEqual(len(features[0]['properties']['records']), 2)
        self.assertEqual(features[0]['properties']['records'][0]['cell_id'], '302220-1-2')
        self.assertEqual(features[0]['properties']['records'][0]['tx_ant_omni_indicator'], 'N')

    def test_excludes_non_telus_outside_and_invalid_coordinates(self):
        self.assertEqual(group_records([row('Rogers'), row('TELUS', lon='-80'), row('TELUS', lat='invalid')]), [])


if __name__ == '__main__':
    unittest.main()
