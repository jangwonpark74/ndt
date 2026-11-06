"""Extract TELUS-licensed ISED records in an approximate Toronto bounding box."""
import argparse
import csv
import hashlib
import io
import json
import zipfile
from collections import Counter
from pathlib import Path

BOUNDS = [-79.64, 43.58, -79.10, 43.85]
FIELDS = ('licence_number', 'record_id', 'location', 'cell_id', 'physical_id', 'technology', 'tx_frequency', 'rx_frequency', 'bandwidth',
          'site_type', 'structure_type', 'structure_height', 'tx_ant_height', 'rx_ant_height', 'tx_ant_omni_indicator', 'rx_ant_omni_indicator',
          'tx_ant_azimuth', 'rx_ant_azimuth', 'tx_ant_horiz_beamwidth', 'rx_ant_horiz_beamwidth', 'tx_ant_elevation_angle', 'rx_ant_elevation_angle',
          'tx_ant_gain', 'rx_ant_gain', 'tx_power', 'tx_line_loss', 'rx_line_loss', 'downlink_allocation', 'class_emission',
          'tx_ant_model_no', 'rx_ant_model_no', 'tx_ant_manufacturer', 'rx_ant_manufacturer', 'tx_radio_model_number', 'rx_radio_model_number', 'date_last_changed')


def group_records(rows):
    sites = {}
    for row in rows:
        licensee = row.get('licensee_name*', '').strip()
        if not licensee.upper().startswith('TELUS'):
            continue
        try:
            lon, lat = float(row['longitude']), float(row['latitude'])
        except (KeyError, ValueError, TypeError):
            continue
        if not (BOUNDS[0] <= lon <= BOUNDS[2] and BOUNDS[1] <= lat <= BOUNDS[3]):
            continue
        site = sites.setdefault((lon, lat), {'licensees':set(), 'records':[]})
        site['licensees'].add(licensee)
        site['records'].append(dict(licensee=licensee, **{field:row.get(field, '').strip() for field in FIELDS}))
    features = []
    for (lon, lat), site in sorted(sites.items()):
        records = site['records']
        technologies = Counter(record['technology'] or 'Not specified' for record in records)
        heights = []
        for record in records:
            try:
                height = float(record['structure_height'])
            except ValueError:
                continue
            if 1 <= height <= 600:
                heights.append(height)
        properties = {'site_id':f'{lon:.7f},{lat:.7f}', 'licensees':sorted(site['licensees']),
                      'record_count':len(records), 'technologies':dict(sorted(technologies.items())), 'records':records}
        if heights:
            properties['height'] = str(max(heights))
        features.append({'type':'Feature', 'geometry':{'type':'Point', 'coordinates':[lon,lat]}, 'properties':properties})
    return features


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ised_zip', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--ised-date', required=True)
    args = parser.parse_args()
    with zipfile.ZipFile(args.ised_zip) as archive:
        names = [name for name in archive.namelist() if name.endswith('.csv')]
        if len(names) != 1:
            raise ValueError('Expected exactly one ISED CSV in the archive')
        with io.TextIOWrapper(archive.open(names[0]), encoding='utf-8-sig', newline='') as stream:
            features = group_records(csv.DictReader(stream))
    hasher = hashlib.sha256()
    with args.ised_zip.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(chunk)
    count = sum(feature['properties']['record_count'] for feature in features)
    data = {'type':'FeatureCollection', 'source':'ISED Terrestrial Spectrum Licence Site Data Extract',
            'ised_date':args.ised_date, 'ised_sha256':hasher.hexdigest(), 'bounds':BOUNDS,
            'record_count':count, 'features':features}
    args.output.write_text(json.dumps(data, separators=(',', ':')))
    print(f'{count} records at {len(features)} distinct coordinates')


if __name__ == '__main__':
    main()
