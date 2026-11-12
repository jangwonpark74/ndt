import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from tree_sampling import metres, sample_row, tile


class TreeSamplingTests(unittest.TestCase):
    def test_units_and_bad_values(self):
        self.assertAlmostEqual(metres('10 ft'), 3.048)
        self.assertEqual(metres('unknown'), 0)

    def test_row_follows_all_segments_and_count(self):
        points = [(-79.4, 43.64), (-79.399, 43.64), (-79.399, 43.641)]
        samples = sample_row(points, count=5)
        self.assertEqual(len(samples), 5)
        self.assertEqual(samples[0], points[0])
        self.assertAlmostEqual(samples[-1][0], points[-1][0])
        self.assertAlmostEqual(samples[-1][1], points[-1][1])
        self.assertTrue(all(-79.4 <= x <= -79.399 and 43.64 <= y <= 43.641 for x,y in samples))
        self.assertEqual(sample_row([points[0],points[0]]), [])

    def test_toronto_tile(self):
        self.assertEqual(tile(-79.3922155,43.6394193), (4578, 5980))


if __name__ == '__main__':
    unittest.main()
