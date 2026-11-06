"""Extract Bell-licensed outdoor ISED locations as shared-network context."""
import argparse
import csv
import hashlib
import io
import json
import zipfile
from collections import Counter
from pathlib import Path

if __package__:
    from .extract_telus_sites import BOUNDS
else:
    from extract_telus_sites import BOUNDS

FIELDS = ('site_type', 'structure_type', 'structure_height', 'tx_ant_height', 'tx_ant_omni_indicator', 'tx_ant_azimuth')


def group_records(rows):
    sites = {}
    for row in rows:
        if row.get('licensee_name*', '').strip() != 'Bell Mobility Inc.' or row.get('site_type') != 'O':
            continue
        try:
            lon, lat = float(row['longitude']), float(row['latitude'])
        except (KeyError, ValueError, TypeError):
            continue
        if not (BOUNDS[0] <= lon <= BOUNDS[2] and BOUNDS[1] <= lat <= BOUNDS[3]):
            continue
        site = sites.setdefault((lon, lat), {'groups':{}, 'licences':set(), 'locations':set(), 'site_ids':set()})
        key = tuple(row.get(field, '').strip() for field in FIELDS)
        group = site['groups'].setdefault(key, {'count':0, 'technologies':Counter(), 'frequencies':set(), 'beamwidths':set()})
        group['count'] += 1
        group['technologies'][row.get('technology', '').strip() or 'Not specified'] += 1
        for source, target in (('tx_frequency','frequencies'), ('tx_ant_horiz_beamwidth','beamwidths')):
            value = row.get(source, '').strip()
            if value:
                group[target].add(value)
        if row.get('licence_number', '').strip():
            site['licences'].add(row['licence_number'].strip())
        if row.get('location', '').strip():
            site['locations'].add(row['location'].strip())
        if row.get('record_id', '').strip():
            site['site_ids'].add(row['record_id'].strip())
    features = []
    for (lon, lat), site in sorted(sites.items()):
        records, technologies = [], Counter()
        for key, group in sorted(site['groups'].items()):
            technologies.update(group['technologies'])
            records.append(dict(zip(FIELDS, key), record_count=group['count'],
                                technologies=sorted(group['technologies']), frequencies=sorted(group['frequencies']),
                                beamwidths=sorted(group['beamwidths'])))
        count = sum(record['record_count'] for record in records)
        properties = {'site_id':f'bell:{lon:.7f},{lat:.7f}', 'provider':'Bell', 'licensees':['Bell Mobility Inc.'],
                      'record_count':count, 'technologies':dict(sorted(technologies.items())),
                      'licences':sorted(site['licences']), 'locations':sorted(site['locations']),
                      'ised_site_ids':sorted(site['site_ids']), 'records':records}
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
    print(f'{count} Bell outdoor records at {len(features)} distinct coordinates')


if __name__ == '__main__':
    main()
