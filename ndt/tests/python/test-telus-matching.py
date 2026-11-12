import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.match_telus import match_sites


def osm(osm_id, lon):
    return {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [lon, 43.7]},
            'properties': {'osm_type': 'node', 'osm_id': osm_id, 'mobile': False}}


def record(lon):
    return {'coordinates': [lon, 43.7], 'licensee': 'TELUS Communications Inc.', 'technology': 'LTE'}


class MatchTest(unittest.TestCase):
    def test_close_unambiguous_match_preserves_distance_and_source(self):
        results = match_sites([osm('1', -79.39)], [record(-79.3901)])
        self.assertEqual(len(results), 1)
        self.assertLess(results[0]['properties']['match_distance_m'], 30)
        self.assertEqual(results[0]['properties']['technologies'], ['LTE'])

    def test_distant_or_ambiguous_locations_are_not_matches(self):
        self.assertEqual(match_sites([osm('1', -79.39)], [record(-79.391)]), [])
        self.assertEqual(match_sites([osm('1', -79.39), osm('2', -79.3901)], [record(-79.39005)]), [])


if __name__ == '__main__':
    unittest.main()
