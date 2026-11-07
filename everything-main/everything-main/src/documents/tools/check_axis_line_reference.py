"""Verify native line-footprint references from retained neutral screen crops."""
from pathlib import Path
from hashlib import sha256
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

def check(folder):
    reference = json.loads((folder / 'native-screen-reference.json').read_bytes())
    for name, key in [('control.docx', 'sourceSha256'), ('cases.json', 'casesSha256'),
                      ('native-screen-atlas.png', 'nativeCropSha256')]:
        assert sha256((folder / name).read_bytes()).hexdigest() == reference[key], name
    source_cases = json.loads((folder / 'cases.json').read_bytes())
    assert len(source_cases) == len(reference['cases'])
    image = Image.open(folder / 'native-screen-atlas.png').convert('RGB')
    pixels = image.load()
    dx = reference['pageOrigin'][0] - reference['nativeCropOrigin'][0]
    dy = reference['pageOrigin'][1] - reference['nativeCropOrigin'][1]
    for source, case in zip(source_cases, reference['cases']):
        assert all(case[key] == value for key, value in source.items())
        left, top, right, bottom = case['region']
        assert 0 <= left + dx < right + dx <= image.width
        assert 0 <= top + dy < bottom + dy <= image.height
        ink = [(x, y) for y in range(top, bottom) for x in range(left, right)
               if sum(pixels[x + dx, y + dy]) < 384]
        assert ink, case['id']
        xs, ys = zip(*ink)
        assert [min(xs), min(ys), max(xs) + 1, max(ys) + 1] == case['nativeBounds'], case['id']
    print(f'PASS {folder.name}: {len(source_cases)} native footprints and source/crop hashes')

if __name__ == '__main__':
    for name in ['axis-line-display', 'axis-line-display-pens']:
        check(ROOT / 'tests/fixtures' / name)
