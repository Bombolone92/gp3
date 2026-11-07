"""Authored cubic mask coverage controls; no corpus geometry or artwork."""
from pathlib import Path
import argparse
import json
import math
import struct
import canvas_svg_fixture as fixture

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir', type=Path)
parser.add_argument('--large', action='store_true', help='Exercise broader native-API counterexamples through the reference application')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
folder = args.output_dir or root / 'tests/fixtures' / ('svg-cubic-coverage-large' if args.large else 'svg-cubic-coverage')
folder.mkdir(parents=True, exist_ok=True)
cases = [
    dict(name='symmetric', controls=[0, 24, 16, 24]),
    dict(name='asymmetric', controls=[1, 31, 13, 7]),
    dict(name='fractional', controls=[.2, 23.7, 15.8, 11.3]),
    dict(name='shallow', controls=[4, .2, 12, .7]),
    dict(name='backtracking', controls=[15, 30, 1, 30]),
    dict(name='degenerate', controls=[0, 0, 16, 0]),
]
definitions, paths = [], []
if args.large:
    source = json.loads((root / 'tests/fixtures/svg-cubic-flatten-sweep/cases.json').read_text())
    cases = []
    for i, index in enumerate([3, 7, 11, 27, 5, 14]):
        original = source[index]
        points = [[math.ceil(struct.unpack('f', struct.pack('f', coordinate))[0]*16)/16 + offset
                   for coordinate, offset in zip(point, [512+i*1100, 512])]
                  for point in original['points']]
        p = [coordinate for point in points for coordinate in point]
        cases.append(dict(name=original['name'], points=points,
                          path=f'M {p[0]} {p[1]} C {p[2]} {p[3]} {p[4]} {p[5]} {p[6]} {p[7]} Z'))
for i, case in enumerate(cases):
    if args.large:
        definitions.append(f'<mask id="m{i}" maskUnits="userSpaceOnUse" x="{i*1100}" y="0" width="1100" height="1100"><rect x="{i*1100}" y="0" width="1100" height="1100" fill="white"/></mask>')
        paths.append(f'<path d="{case["path"]}" fill="#2060C0" mask="url(#m{i})"/>')
        continue
    x, y = 2 + 20 * i, 10
    a, b, c, d = case['controls']
    path = f'M {x} {y} C {x+a} {y+b} {x+c} {y+d} {x+16} {y} L {x+16} 70 L {x} 70 Z'
    case['path'] = path
    definitions.append(f'<mask id="m{i}" maskUnits="userSpaceOnUse" x="{x}" y="10" width="16" height="60"><rect x="{x}" y="10" width="16" height="60" fill="white"/></mask>')
    paths.append(f'<path d="{path}" fill="#2060C0" mask="url(#m{i})"/>')
fixture.SOURCE = folder / 'control.docx'
width, height = (6600, 1100) if args.large else (120, 80)
fixture.SVG = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><defs>' + ''.join(definitions) + '</defs>' + ''.join(paths) + '</svg>').encode()
fixture.generate()
(folder / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
