# /// script
# requires-python = ">=3.10"
# dependencies = ["osmium==4.3.2"]
# ///
"""Extract mapped street lamps and benches from an OSM PBF into zoom-14 tiles."""
import argparse
import json
from pathlib import Path

import osmium
from tree_sampling import tile, ZOOM


class StreetDetail(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.tiles = {}
        self.counts = {'lamp': 0, 'bench': 0}

    def node(self, node):
        kind = 'lamp' if node.tags.get('highway') == 'street_lamp' else 'bench' if node.tags.get('amenity') == 'bench' else None
        if not kind or not node.location.valid():
            return
        lon, lat = round(node.location.lon, 7), round(node.location.lat, 7)
        x, y = tile(lon, lat)
        self.tiles.setdefault(f'{x}/{y}', []).append([lon, lat, kind])
        self.counts[kind] += 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--source', default='OSM PBF supplied by caller')
    args = parser.parse_args()
    if args.output.exists() and any(args.output.iterdir()):
        parser.error('output directory must be empty')
    handler = StreetDetail()
    handler.apply_file(str(args.input))
    args.output.mkdir(parents=True, exist_ok=True)
    for key, records in handler.tiles.items():
        path = args.output / f'{key}.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(records, separators=(',', ':')))
    manifest = {'source':args.source, 'zoom':ZOOM, 'counts':handler.counts,
                'tiles':{key:len(records) for key, records in handler.tiles.items()}}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
    print(f"Extracted {handler.counts['lamp']} lamps and {handler.counts['bench']} benches")


if __name__ == '__main__':
    main()
