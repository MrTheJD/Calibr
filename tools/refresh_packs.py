#!/usr/bin/env python3
"""Rebuild every pack listed in packs/index.json when Overture has published a newer release.

    python tools/refresh_packs.py [--force]

Used by .github/workflows/refresh-packs.yml (monthly). Exits 0 whether or not anything changed;
prints "changed" when files were rewritten.
"""
import json, os, subprocess, sys

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
from build_pack import latest_release  # noqa: E402

index_path = os.path.join(here, '..', 'packs', 'index.json')
index = json.load(open(index_path))
latest = latest_release()
force = '--force' in sys.argv
changed = []
for p in index['packs']:
    if not force and p.get('release') == latest:
        print(f"{p['name']}: already on {latest}")
        continue
    print(f"{p['name']}: {p.get('release', 'unknown')} -> {latest}")
    bbox = ','.join(str(x) for x in p['bbox'])
    subprocess.run([sys.executable, os.path.join(here, 'build_pack.py'), '--name', p['name'], '--label', p['label'], f'--bbox={bbox}', '--release', latest], check=True)
    changed.append(p['name'])
print('changed' if changed else 'nothing to do', *changed)
