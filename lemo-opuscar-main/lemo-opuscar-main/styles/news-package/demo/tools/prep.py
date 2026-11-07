"""assets/plates/ + raw/ → assets/：the illustrative plates get one shared grade (cool duotone); the Europe map is decoded and projected into 2D paths.
The plates' source files assets/plates/plate_*.jpg are committed with the repo (AI-generated, see CREDITS); a missing image exits with an error.
Run with the library's .venv:$LIB/.venv/bin/python tools/prep.py"""
import json, math, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW, PLATES, OUT = os.path.join(HERE, 'raw'), os.path.join(HERE, 'assets', 'plates'), os.path.join(HERE, 'assets')
os.makedirs(OUT, exist_ok=True)

# —— Shared grade: every picture-layer asset goes through the same curve (brand black → off-white) ——
SHADOW = np.array([14, 16, 19], float)     # #0E1013, a little deeper than brand black #121417
LIGHT = np.array([236, 231, 216], float)   # #ECE7D8, brand off-white #F4F1E8 pulled down one step
def grade(im, black=8, white=232, gamma=1.05):
    g = np.asarray(im.convert('L'), float)
    lo, hi = np.percentile(g, 0.5), np.percentile(g, 99.6)
    g = np.clip((g - lo) / max(1, hi - lo), 0, 1) ** gamma
    g = g * g * (3 - 2 * g) * .35 + g * .65
    g = black / 255 + g * (white - black) / 255
    rgb = SHADOW[None, None] + (LIGHT - SHADOW)[None, None] * g[..., None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))

meta = {}
for name, crop in [('datacenter', None), ('wafer', None)]:
    src = os.path.join(PLATES, f'plate_{name}.jpg')
    if not os.path.exists(src):
        sys.exit(f'missing plate: {src} (generate it with tools/gen_plates.sh or put your own image there; STYLE.md §10)')
    im = Image.open(src).convert('RGB')
    if crop: im = im.crop(crop)
    grade(im).save(os.path.join(OUT, f'plate_{name}.jpg'), quality=92)
    meta[name] = im.size

# —— Europe map: world-atlas countries-50m (Natural Earth, public domain) → Lambert azimuthal equal-area projection (centre 10°E 52°N, same idea as EPSG:3035) ——
# Only the 27 EU member states are drawn as countries, each as one whole shape (Cyprus is the whole island; Åland is part of Finland).
# Every other piece of land is merged into a single "land" shape with no borders inside it: the film is about the EU only,
# and the source data's de facto lines (Kosovo, Crimea, northern Cyprus, Western Sahara and the like) never reach the screen.
topo = json.load(open(os.path.join(RAW, 'countries-50m.json')))
sx, sy = topo['transform']['scale']; tx, ty = topo['transform']['translate']
arcs = []                                                   # quantised integer points: shared arc ends match exactly
for a in topo['arcs']:
    x = y = 0; pts = []
    for dx, dy in a:
        x += dx; y += dy; pts.append((x, y))
    arcs.append(pts)
L0, P0 = math.radians(10), math.radians(52)
def laea(lon, lat):
    l, p = math.radians(lon), math.radians(lat)
    k = math.sqrt(2 / (1 + math.sin(P0) * math.sin(p) + math.cos(P0) * math.cos(p) * math.cos(l - L0)))
    x = k * math.cos(p) * math.sin(l - L0)
    y = k * (math.cos(P0) * math.sin(p) - math.sin(P0) * math.cos(p) * math.cos(l - L0))
    return round(x * 6371, 1), round(-y * 6371, 1)          # km, y points down
def arc_pts(i): return arcs[i] if i >= 0 else arcs[~i][::-1]
def merge(geoms):
    """Outline of the union of several countries (as topojson.merge): keep the arcs used exactly once, chain them into rings."""
    use = {}
    for g in geoms:
        for poly in (g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]):
            for r in poly:
                for i in r: use.setdefault(i if i >= 0 else ~i, []).append(i)
    segs = [arc_pts(v[0]) for v in use.values() if len(v) == 1]
    by_start = {}
    for k, sg in enumerate(segs): by_start.setdefault(sg[0], []).append(k)
    done, rings = set(), []
    for k in range(len(segs)):
        if k in done: continue
        done.add(k); pts = list(segs[k])
        while pts[-1] != pts[0]:
            nxt = next((j for j in by_start.get(pts[-1], []) if j not in done), None)
            if nxt is None: break
            done.add(nxt); pts += segs[nxt][1:]
        rings.append([(x * sx + tx, y * sy + ty) for x, y in pts])
    return rings
EU27 = {'040', '056', '100', '191', '196', '203', '208', '233', '246', '250', '276', '300', '348', '372', '380', '428', '440', '442',
        '470', '528', '616', '620', '642', '703', '705', '724', '752'}
PART_OF = {'N. Cyprus': '196', 'Åland': '246'}             # drawn inside the member state they belong to
WIN = (-32, 25, 60, 75)  # lon/lat window: keep only rings that intersect the Europe window; ring points outside the window are clamped to its edge
def clip(rings):
    out = []
    for pts in rings:
        if not any(WIN[0] <= x <= WIN[2] and WIN[1] <= y <= WIN[3] for x, y in pts): continue
        pts = [(min(max(x, WIN[0] - 8), WIN[2] + 8), min(max(y, WIN[1] - 6), WIN[3] + 6)) for x, y in pts]
        out.append([laea(x, y) for x, y in pts])
    return out
groups, names, rest = {}, {}, []
for g in topo['objects']['countries']['geometries']:
    if 'arcs' not in g: continue
    cid = PART_OF.get(g['properties']['name'], g.get('id'))
    if cid in EU27:
        groups.setdefault(cid, []).append(g)
        if g.get('id') == cid: names[cid] = g['properties']['name']
    else: rest.append(g)
countries = {'land': {'name': 'land', 'eu': False, 'rings': clip(merge(rest))}}
for cid in groups:
    rings = clip(merge(groups[cid]))
    if rings: countries[cid] = {'name': names[cid], 'eu': True, 'rings': rings}
DUBLIN = laea(-6.2603, 53.3498)
json.dump({'countries': countries, 'dublin': DUBLIN, 'brussels': laea(4.3517, 50.8503)}, open(os.path.join(OUT, 'europe.json'), 'w'), separators=(',', ':'))

json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)
print(meta, len(countries) - 1, 'EU members + one land shape; Dublin', DUBLIN, 'EU', sum(c['eu'] for c in countries.values()))
