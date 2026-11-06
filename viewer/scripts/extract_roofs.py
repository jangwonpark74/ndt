# /// script
# requires-python = ">=3.10"
# dependencies = ["osmium==4.3.2"]
# ///
"""Extract mapped roof shapes from a BBBike OSM PBF into a compact viewer dataset."""
import argparse
import json
from pathlib import Path

import osmium

SUPPORTED = {'flat', 'skillion', 'shed', 'gabled', 'pitched', 'hipped', 'pyramidal', 'dome', 'onion', 'cone'}
KEYS = ('height', 'min_height', 'building:levels', 'building:min_level', 'building:colour',
        'building:material', 'roof:height', 'roof:levels', 'roof:angle', 'roof:direction',
        'roof:orientation', 'roof:colour', 'roof:material', 'name')


def roof_shape(tags):
    shape = tags.get('roof:shape', tags.get('building:roof:shape', '')).lower()
    if not shape and (tags.get('roof:colour') or tags.get('roof:material')):
        shape = 'flat'
    building, part = tags.get('building'), tags.get('building:part')
    if shape not in SUPPORTED or not ((building and building != 'no') or (part and part != 'no')):
        return None
    if shape == 'flat' and not (tags.get('roof:colour') or tags.get('roof:material')):
        return None
    return {'shed':'skillion', 'pitched':'gabled'}.get(shape, shape)


class Roofs(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.roofs = []

    def way(self, way):
        tags = dict(way.tags)
        shape = roof_shape(tags)
        if not shape:
            return
        if len(way.nodes) < 4 or way.nodes[0].ref != way.nodes[-1].ref:
            return
        try:
            ring = [[round(n.lon, 7), round(n.lat, 7)] for n in way.nodes]
        except osmium.InvalidLocationError:
            return
        self.roofs.append({'id': way.id, 'shape': shape, 'ring': ring, 'tags': {key: tags[key] for key in KEYS if key in tags}})

    def area(self, area):
        if area.from_way():
            return
        tags = dict(area.tags)
        shape = roof_shape(tags)
        if not shape:
            return
        def coordinates(ring):
            return [[round(node.lon, 7), round(node.lat, 7)] for node in ring]
        try:
            polygons = [[coordinates(outer), *[coordinates(inner) for inner in area.inner_rings(outer)]]
                        for outer in area.outer_rings()]
        except osmium.InvalidLocationError:
            return
        if polygons:
            self.roofs.append({'id': area.orig_id(), 'type': 'relation', 'shape': shape, 'polygons': polygons,
                               'tags': {key: tags[key] for key in KEYS if key in tags}})


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('input', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--source', default='OSM PBF supplied by caller')
args = parser.parse_args()
handler = Roofs()
handler.apply_file(str(args.input), locations=True, idx='flex_mem')
args.output.write_text(json.dumps({'source': args.source, 'roofs': handler.roofs}, separators=(',', ':')))
print(f'Extracted {len(handler.roofs)} mapped roofs to {args.output}')
