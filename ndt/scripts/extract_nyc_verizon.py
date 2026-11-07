"""Convert NYC pole reservation JSON into Verizon-affiliated GeoJSON."""
import argparse
import json
from pathlib import Path


def convert(rows):
    features = []
    for row in rows:
        if row.get('franchisee') != 'NY SMSA':
            continue
        try:
            lon, lat = float(row['longitude']), float(row['latitude'])
        except (KeyError, TypeError, ValueError):
            continue
        if not (-74.3 <= lon <= -73.7 and 40.45 <= lat <= 40.95):
            continue
        properties = {key: row[key] for key in ('id', 'franchisee', 'status', 'pole_type', 'borough', 'on_street', 'cross_street_1', 'cross_street_2', 'reservation_date', 'installation_date') if row.get(key)}
        features.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [lon, lat]}, 'properties': properties})
    return {'type': 'FeatureCollection', 'source': 'NYC Open Data tbgj-tdd6; downloaded 2026-11-07', 'features': features}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = convert(json.loads(args.input.read_text()))
    args.output.write_text(json.dumps(result, separators=(',', ':')))
    print(f"Extracted {len(result['features'])} NY SMSA pole reservations")


if __name__ == '__main__':
    main()
