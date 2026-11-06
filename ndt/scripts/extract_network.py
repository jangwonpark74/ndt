# /// script
# requires-python = ">=3.10"
# dependencies = ["osmium==4.3.2"]
# ///
"""Extract OSM communications structures as point features for map context."""
import argparse
import json
from pathlib import Path

import osmium


class Communications(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.features = []

    @staticmethod
    def matches(tags):
        structure = tags.get('man_made', '')
        return tags.get('communication:mobile_phone') == 'yes' or (structure in ('tower', 'mast', 'communications_tower') and
               (tags.get('tower:type') == 'communication' or structure == 'communications_tower'))

    def add(self, obj, kind, lon, lat):
        tags = obj.tags
        mobile = tags.get('communication:mobile_phone') == 'yes'
        if not self.matches(tags):
            return
        properties = {'osm_type': kind, 'osm_id': str(obj.id), 'mobile': mobile}
        for key in ('name', 'operator', 'height', 'man_made', 'tower:type', 'communication:mobile_phone'):
            value = tags.get(key)
            if value:
                properties[key] = value
        self.features.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(lon, 7), round(lat, 7)]}, 'properties': properties})

    def node(self, node):
        if node.location.valid():
            self.add(node, 'node', node.location.lon, node.location.lat)

    def way(self, way):
        if not self.matches(way.tags):
            return
        locations = [node.location for node in way.nodes]
        if locations and all(location.valid() for location in locations):
            self.add(way, 'way', (min(p.lon for p in locations) + max(p.lon for p in locations)) / 2,
                     (min(p.lat for p in locations) + max(p.lat for p in locations)) / 2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--source', default='OSM PBF supplied by caller')
    args = parser.parse_args()
    handler = Communications()
    handler.apply_file(str(args.input), locations=True)
    data = {'type': 'FeatureCollection', 'source': args.source, 'features': handler.features}
    args.output.write_text(json.dumps(data, separators=(',', ':')))
    print(f'Extracted {len(handler.features)} mapped communications features')


if __name__ == '__main__':
    main()
