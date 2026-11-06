# /// script
# requires-python = ">=3.10"
# dependencies = ["osmium==4.3.2"]
# ///
"""Extract OSM trees and deterministic tree-row estimates into zoom-14 tiles."""
import argparse
import json
import math
from pathlib import Path

import osmium
from tree_sampling import metres, sample_row, tile, ZOOM


class Trees(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.nodes = []
        self.rows = []

    @staticmethod
    def attributes(tags):
        height = metres(tags.get('height'))
        crown = metres(tags.get('diameter_crown') or tags.get('crown:diameter'))
        needle = tags.get('leaf_type', '').lower() == 'needleleaved'
        return [round(height, 2), round(crown, 2), int(needle)]

    def node(self, node):
        if node.tags.get('natural') == 'tree' and node.location.valid():
            self.nodes.append([round(node.location.lon, 7), round(node.location.lat, 7), *self.attributes(node.tags), 0])

    def way(self, way):
        if way.tags.get('natural') != 'tree_row':
            return
        try:
            points = [(n.lon, n.lat) for n in way.nodes]
        except osmium.InvalidLocationError:
            return
        try:
            count = int(way.tags.get('tree:count') or way.tags.get('count') or 0)
        except ValueError:
            count = 0
        spacing = metres(way.tags.get('spacing')) or 8
        attributes = self.attributes(way.tags)
        self.rows.extend([[round(lon, 7), round(lat, 7), *attributes, 1] for lon, lat in sample_row(points, count, spacing)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path, help='New, empty output directory')
    parser.add_argument('--source', default='OSM PBF supplied by caller')
    args = parser.parse_args()
    if args.output.exists() and any(args.output.iterdir()):
        parser.error('output directory must be empty')
    handler = Trees()
    handler.apply_file(str(args.input), locations=True, idx='flex_mem')
    # A row point within two metres of a mapped tree is redundant.
    buckets = {}
    def cell(lon, lat):
        return (math.floor(lon * 80600 / 2), math.floor(lat * 111320 / 2))
    for tree in handler.nodes:
        buckets.setdefault(cell(*tree[:2]), []).append(tree)
    derived = []
    for tree in handler.rows:
        lon, lat = tree[:2]
        x, y = cell(lon, lat)
        near = any(math.hypot((lon-other[0])*80600, (lat-other[1])*111320) < 2
                   for dx in (-1,0,1) for dy in (-1,0,1) for other in buckets.get((x+dx,y+dy), []))
        if not near:
            derived.append(tree)
            buckets.setdefault((x,y), []).append(tree)
    tiles = {}
    for tree in handler.nodes + derived:
        x, y = tile(*tree[:2])
        tiles.setdefault(f'{x}/{y}', []).append(tree)
    args.output.mkdir(parents=True, exist_ok=True)
    for key, trees in tiles.items():
        path = args.output / f'{key}.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(trees, separators=(',', ':')))
    overview = {'type':'FeatureCollection', 'features':[
        {'type':'Feature', 'geometry':{'type':'Point', 'coordinates':tree[:2]}, 'properties':{'estimated':tree[5]}}
        for tree in handler.nodes + derived
    ]}
    (args.output / 'overview.geojson').write_text(json.dumps(overview, separators=(',', ':')))
    manifest = {'source':args.source, 'zoom':ZOOM, 'mapped':len(handler.nodes), 'row_estimates':len(derived), 'tiles':{key:len(value) for key,value in tiles.items()}}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
    print(f"Extracted {manifest['mapped']} mapped trees and {manifest['row_estimates']} row estimates in {len(tiles)} tiles")


if __name__ == '__main__':
    main()
