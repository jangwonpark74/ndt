"""Convert an OSM API XML snapshot to the viewer's compact JSON format."""
import json
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()
nodes = {n.attrib['id']: {'lat': float(n.attrib['lat']), 'lon': float(n.attrib['lon'])} for n in root.findall('node')}
elements = []
for way in root.findall('way'):
    tags = {tag.attrib['k']: tag.attrib['v'] for tag in way.findall('tag')}
    if not any(key in tags for key in ('building', 'building:part', 'highway')):
        continue
    refs = [nd.attrib['ref'] for nd in way.findall('nd')]
    if not all(ref in nodes for ref in refs):
        continue
    elements.append({'type':'way', 'id': int(way.attrib['id']), 'tags': tags, 'geometry': [nodes[ref] for ref in refs]})
with open(sys.argv[2], 'w') as output:
    json.dump({'source':'OpenStreetMap API 0.6', 'generator':root.attrib.get('generator'), 'elements':elements}, output, separators=(',', ':'))
print(f'Wrote {len(elements)} OSM ways')
