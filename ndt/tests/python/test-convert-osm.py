import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class ConvertOsmTest(unittest.TestCase):
    def test_converts_supported_ways_and_skips_incomplete_geometry(self):
        xml = '''<osm generator="fixture">
          <node id="1" lat="43.7" lon="-79.4"/>
          <node id="2" lat="43.8" lon="-79.3"/>
          <way id="10"><nd ref="1"/><nd ref="2"/><tag k="building" v="yes"/></way>
          <way id="11"><nd ref="1"/><nd ref="3"/><tag k="highway" v="residential"/></way>
          <way id="12"><nd ref="1"/><tag k="natural" v="tree"/></way>
        </osm>'''
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'input.osm'
            output = Path(directory) / 'output.json'
            source.write_text(xml)
            script = Path(__file__).resolve().parents[2] / 'scripts' / 'convert_osm.py'
            result = subprocess.run([sys.executable, str(script), str(source), str(output)],
                                    check=True, capture_output=True, text=True)
            data = json.loads(output.read_text())
        self.assertIn('Wrote 1 OSM ways', result.stdout)
        self.assertEqual(data['generator'], 'fixture')
        self.assertEqual(data['elements'], [{
            'type': 'way', 'id': 10, 'tags': {'building': 'yes'},
            'geometry': [{'lat': 43.7, 'lon': -79.4}, {'lat': 43.8, 'lon': -79.3}],
        }])


if __name__ == '__main__':
    unittest.main()
