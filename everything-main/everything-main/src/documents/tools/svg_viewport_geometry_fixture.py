"""Original SVG viewport geometry controls; no corpus assets or engine imports."""
from pathlib import Path
import json
import canvas_svg_fixture as fixture

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/svg-viewport-geometry'
CASES = [
    ('small', 16, 12), ('medium', 80, 40),
    ('fractional', 120.5, 80.25), ('odd', 241, 161),
    ('bleed', 80, 40), ('shifted', 80, 40),
    ('physical', 160, 320/3), ('ratio-only', 80, 40),
    ('percent', 80, 40),
]

def generate(only=None):
    OUT.mkdir(parents=True, exist_ok=True)
    for name, width, height in CASES:
        if only is not None and name not in only: continue
        fixture.SOURCE = OUT / f'{name}.docx'
        # A viewport-sized rectangle exposes all four edges; an inset rectangle
        # independently distinguishes translation from scale and clipping.
        fixture.SVG = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}">'
            f'<rect width="{width}" height="{height}" fill="#4080C0"/>'
            f'<rect x="{width/4}" y="{height/4}" width="{width/2}" height="{height/2}" fill="#D08040"/>'
            '</svg>'
        ).encode()
        if name == 'bleed':
            fixture.SVG = fixture.SVG.replace(b'viewBox=', b'overflow="visible" viewBox=').replace(
                b'<rect width="80" height="40"', b'<rect x="-2" y="-3" width="84" height="46"')
        elif name == 'shifted':
            fixture.SVG = fixture.SVG.replace(b'viewBox="0 0 80 40"', b'viewBox="10 -20 80 40"').replace(
                b'<rect width="80" height="40"', b'<rect x="10" y="-20" width="80" height="40"').replace(
                b'x="20.0" y="10.0"', b'x="30" y="-10"')
        elif name == 'physical':
            fixture.SVG = fixture.SVG.replace(f'width="{width}" height="{height}"'.encode(), b'width="120pt" height="80pt"', 1)
        elif name == 'ratio-only':
            fixture.SVG = fixture.SVG.replace(b' width="80" height="40"', b'', 1)
        elif name == 'percent':
            fixture.SVG = fixture.SVG.replace(b'<rect width="80" height="40"', b'<rect width="100%" height="100%"').replace(
                b'<rect x="20.0" y="10.0" width="40.0" height="20.0"', b'<rect x="25%" y="25%" width="50%" height="50%"')
        fixture.generate()
    (OUT / 'cases.json').write_text(json.dumps([
        dict(name=n, width=w, height=h) for n,w,h in CASES
    ], indent=2) + '\n')

if __name__ == '__main__':
    generate()
