#!/usr/bin/env python3
"""Build an offline places pack for Calibr from Overture Maps (https://overturemaps.org).

    pip install "duckdb==1.4.2"      # duckdb 2.0.0 crashes on this dataset at the time of writing
    python tools/build_pack.py --name austin --label "Austin, TX" --place "Austin, Texas" --radius-km 6
    python tools/build_pack.py --name midtown --center 40.7580,-73.9855 --radius-km 3
    python tools/build_pack.py --name custom  --bbox -97.80,30.22,-97.68,30.33

Writes packs/<name>.json and updates packs/index.json. Only places where people spend money are kept
(shops, food, fuel, health, entertainment...), not offices or government buildings.

Overture places data is a mix of permissively licensed sources (CDLA-Permissive-2.0, Apache-2.0, CC0-1.0);
keep the attribution in the pack.
"""
import argparse, json, math, os, re, sys, urllib.parse, urllib.request
from datetime import date

KINDS = ['grocery', 'dining', 'coffee', 'fuel', 'transport', 'shopping', 'health', 'entertainment',
         'fitness', 'home', 'pets', 'personal', 'travel', 'education', 'services']


def kind_of(h):
    """Map an Overture taxonomy hierarchy (list of strings) to a Calibr spending kind, or None to drop."""
    h = [x for x in (h or []) if x]
    if not h:
        return None
    top, rest = h[0], set(h[1:])
    last = h[-1]
    if top == 'food_and_drink':
        if rest & {'cafe', 'coffee_shop', 'tea_room', 'non_alcoholic_beverage_venue', 'coffee_roastery'}:
            return 'coffee'
        return 'dining'
    if top == 'shopping':
        if rest & {'grocery_store', 'supermarket', 'convenience_store', 'food_and_beverage_store', 'farmers_market', 'warehouse_club'}:
            return 'grocery'
        if last in {'pharmacy', 'drugstore'} or 'pharmacy' in rest:
            return 'health'
        if any(re.search(r'home|garden|hardware|furniture|appliance|building_supply', x) for x in rest):
            return 'home'
        if any('pet' in x.split('_') for x in rest):
            return 'pets'
        return 'shopping'
    if top == 'health_care':
        return 'health'
    if top == 'travel_and_transportation':
        if rest & {'fueling_station', 'gas_station', 'ev_charging_station'}:
            return 'fuel'
        if rest & {'parking', 'ground_transport_facility_or_service', 'vehicle_service', 'taxi_service'}:
            return 'transport'
        if rest & {'travel_service', 'air_transport_facility_or_service'}:
            return 'travel'
        return None
    if top == 'lodging':
        return 'travel'
    if top == 'arts_and_entertainment':
        return 'entertainment'
    if top == 'sports_and_recreation':
        if rest & {'sport_or_fitness_facility'}:
            return 'fitness'
        if rest & {'park'}:
            return None
        return 'entertainment'
    if top == 'lifestyle_services':
        if 'animal_or_pet_service' in rest:
            return 'pets'
        if 'wellness_service' in rest:
            return 'health'
        return 'personal'
    if top == 'education':
        return 'education' if rest & {'place_of_learning', 'educational_service'} else None
    if top == 'services_and_business':
        if rest & {'laundry_service'}:
            return 'personal'
        if rest & {'home_service'}:
            return 'home'
        if rest & {'shipping_or_delivery_service', 'printing_service'}:
            return 'services'
        return None
    return None


FOOD_WORDS = re.compile(r"restaurant|pizz|grill|diner|bistro|taqueria|sushi|burger|kitchen|steakhouse|cantina|noodle|ramen|trattoria", re.I)
STREET = re.compile(r"^\d{1,5}\s+(\S+\s+){0,2}(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|pl|place|plaza|way|broadway|pkwy|hwy)\.?$", re.I)


def latest_release():
    url = 'https://overturemaps-us-west-2.s3.amazonaws.com/?prefix=release/&delimiter=/'
    xml = urllib.request.urlopen(url, timeout=30).read().decode()
    rels = re.findall(r'<Prefix>release/([^/]+)/</Prefix>', xml)
    return sorted(rels)[-1]


def geocode(q):
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({'q': q, 'format': 'json', 'limit': 1})
    req = urllib.request.Request(url, headers={'User-Agent': 'Calibr-pack-builder/1.0 (+https://github.com/MrTheJD/Calibr)'})
    r = json.load(urllib.request.urlopen(req, timeout=30))
    if not r:
        sys.exit(f'Could not find "{q}"')
    return float(r[0]['lat']), float(r[0]['lon']), r[0].get('display_name', q)


def bbox_around(lat, lng, km):
    dlat = km / 111.32
    dlng = km / (111.32 * math.cos(math.radians(lat)))
    return [round(lng - dlng, 5), round(lat - dlat, 5), round(lng + dlng, 5), round(lat + dlat, 5)]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--name', required=True, help='file name, e.g. austin')
    ap.add_argument('--label', help='human label shown in the app')
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--place', help='place name to geocode, e.g. "Austin, Texas"')
    g.add_argument('--center', help='lat,lng')
    g.add_argument('--bbox', help='west,south,east,north')
    ap.add_argument('--radius-km', type=float, default=6, help='radius around --place/--center (default 6)')
    ap.add_argument('--release', default='latest')
    ap.add_argument('--min-confidence', type=float, default=0.6)
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'packs'))
    a = ap.parse_args()
    if not re.fullmatch(r'[a-z0-9-]+', a.name):
        sys.exit('--name must be lowercase letters, digits and dashes')

    label = a.label
    if a.bbox:
        bbox = [float(x) for x in a.bbox.split(',')]
    else:
        if a.place:
            lat, lng, disp = geocode(a.place)
            label = label or a.place
        else:
            lat, lng = [float(x) for x in a.center.split(',')]
        bbox = bbox_around(lat, lng, a.radius_km)
    label = label or a.name
    rel = latest_release() if a.release == 'latest' else a.release
    print(f'bbox {bbox}  release {rel}', file=sys.stderr)

    import duckdb
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; "
                "CREATE OR REPLACE SECRET anon (TYPE s3, PROVIDER config, REGION 'us-west-2');")
    rows = con.execute(f"""
        SELECT names.primary, brand.names.primary, taxonomy.hierarchy, bbox.ymin, bbox.xmin
        FROM read_parquet('s3://overturemaps-us-west-2/release/{rel}/theme=places/type=place/*', hive_partitioning=1)
        WHERE bbox.xmin BETWEEN ? AND ? AND bbox.ymin BETWEEN ? AND ?
          AND confidence >= ? AND coalesce(operating_status, 'open') = 'open' AND names.primary IS NOT NULL
    """, [bbox[0], bbox[2], bbox[1], bbox[3], a.min_confidence]).fetchall()
    print(f'{len(rows)} raw places', file=sys.stderr)

    places, seen = [], set()
    for name, brand, hier, lat_, lng_ in rows:
        kind = kind_of(hier)
        name = re.sub(r'\s+', ' ', name).strip()[:60]
        if not kind or STREET.match(name):
            continue
        if kind == 'grocery' and FOOD_WORDS.search(name):
            kind = 'dining'
        key = (name.lower(), round(lat_ * 1e4), round(lng_ * 1e4))  # drop duplicates ~10 m apart
        if key in seen:
            continue
        seen.add(key)
        places.append([round(lat_ * 1e5), round(lng_ * 1e5), name, KINDS.index(kind), (brand or '')[:40] if brand and brand != name else ''])
    places.sort(key=lambda p: (p[0], p[1]))
    pack = {'v': 1, 'name': a.name, 'label': label, 'bbox': bbox, 'built': date.today().isoformat(), 'release': rel,
            'attribution': 'Places data © Overture Maps Foundation and its sources (CDLA-Permissive-2.0, Apache-2.0, CC0-1.0)', 'kinds': KINDS, 'places': places}

    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, a.name + '.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(pack, f, ensure_ascii=False, separators=(',', ':'))
    size = os.path.getsize(path)

    idx_path = os.path.join(a.out, 'index.json')
    idx = json.load(open(idx_path)) if os.path.exists(idx_path) else {'v': 1, 'packs': []}
    idx['packs'] = [p for p in idx['packs'] if p['name'] != a.name] + [
        {'name': a.name, 'label': label, 'bbox': bbox, 'file': a.name + '.json', 'places': len(places), 'bytes': size, 'built': pack['built']}]
    json.dump(idx, open(idx_path, 'w'), indent=1)
    print(f'wrote {path}: {len(places)} places, {size/1024:.0f} KB (about {size/4/1024:.0f} KB gzipped)', file=sys.stderr)


if __name__ == '__main__':
    main()
