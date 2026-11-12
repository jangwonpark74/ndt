"""Match TELUS licensed radio locations to nearby, unambiguous OSM structures."""
import argparse
import csv
import hashlib
import io
import json
import math
import zipfile
from collections import defaultdict
from pathlib import Path

MAX_DISTANCE_M = 30


def distance_m(a, b):
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, math.radians(b[0] - a[0])
    v = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 12742000 * math.asin(min(1, math.sqrt(v)))


def match_sites(features, records):
    matched = defaultdict(list)
    for record in records:
        candidates = [(distance_m(record['coordinates'], f['geometry']['coordinates']), f) for f in features]
        candidates = [(distance, f) for distance, f in candidates if distance <= MAX_DISTANCE_M]
        if len(candidates) != 1:
            continue
        distance, feature = candidates[0]
        key = (feature['properties']['osm_type'], feature['properties']['osm_id'])
        matched[key].append((distance, record))
    output = []
    for feature in features:
        p = feature['properties']
        rows = matched.get((p['osm_type'], p['osm_id']))
        if not rows:
            continue
        nearest = min(rows, key=lambda item: item[0])
        properties = dict(p, match_distance_m=round(nearest[0], 1),
                          ised_coordinates=nearest[1]['coordinates'],
                          licensees=sorted({r['licensee'] for _, r in rows}),
                          technologies=sorted({r['technology'] for _, r in rows if r['technology']}),
                          ised_locations=len({tuple(r['coordinates']) for _, r in rows}))
        output.append(dict(feature, properties=properties))
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('osm', type=Path)
    parser.add_argument('ised_zip', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--ised-date', required=True)
    args = parser.parse_args()
    osm = json.loads(args.osm.read_text(encoding='utf-8'))
    features = osm['features']
    lons = [f['geometry']['coordinates'][0] for f in features]
    lats = [f['geometry']['coordinates'][1] for f in features]
    records = []
    with zipfile.ZipFile(args.ised_zip) as archive:
        names = [name for name in archive.namelist() if name.endswith('.csv')]
        if len(names) != 1:
            raise ValueError('Expected exactly one ISED CSV in the archive')
        with io.TextIOWrapper(archive.open(names[0]), encoding='utf-8-sig', newline='') as stream:
            for row in csv.DictReader(stream):
                licensee = row['licensee_name*'].strip()
                if not licensee.upper().startswith('TELUS'):
                    continue
                try:
                    lon, lat = float(row['longitude']), float(row['latitude'])
                except ValueError:
                    continue
                if min(lons)-.001 <= lon <= max(lons)+.001 and min(lats)-.001 <= lat <= max(lats)+.001:
                    records.append({'coordinates':[lon,lat], 'licensee':licensee, 'technology':row['technology'].strip()})
    matched = match_sites(features, records)
    hasher = hashlib.sha256()
    with args.ised_zip.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(chunk)
    digest = hasher.hexdigest()
    data = {'type':'FeatureCollection', 'source_osm':osm.get('source'), 'source_ised':'ISED Terrestrial Spectrum Licence Site Data Extract',
            'ised_date':args.ised_date, 'ised_sha256':digest, 'max_distance_m':MAX_DISTANCE_M, 'features':matched}
    args.output.write_text(json.dumps(data, separators=(',', ':')))
    print(f'{len(matched)} OSM structures matched to TELUS records within {MAX_DISTANCE_M} m')


if __name__ == '__main__':
    main()
