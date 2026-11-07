"""Original 36-case mask color/opacity matrix; no corpus media or text."""
from pathlib import Path
import json
import sys
import canvas_svg_fixture as fixture

root = Path(__file__).resolve().parents[1]
intermediate = '--intermediate' in sys.argv
boundary = '--boundary' in sys.argv
name = 'svg-mask-intermediate' if intermediate else 'svg-mask-quantization'
if boundary:
    name += '-boundary'
folder = root / 'tests/fixtures' / name
folder.mkdir(exist_ok=True)
fixture.SOURCE = root / 'public/fixtures' / (name+'.docx')
cases, defs, shapes = [], [], []
colors = ['#0000FF', '#FFFF00', '#00FFFF', '#FF00FF', '#010203', '#FEFDFB'] if boundary else ['#FFFFFF', '#808080', '#2060C0', '#FF0000', '#00FF00', '#123456']
opacities = [.01, .1, .333333, .501, .9, .999] if boundary else [1, .5, .125, .25, .75, 254/255]
for row, color in enumerate(colors):
    for col, opacity in enumerate(opacities):
        i, x, y = len(cases), col*20+2, row*12+2
        cases.append(dict(color=color, opacity=opacity, x=x+8, y=y+4))
        defs.append(f'<mask id="m{i}" maskUnits="userSpaceOnUse" x="{x}" y="{y}" width="16" height="8"><rect x="{x}" y="{y}" width="16" height="8" fill="{color}" fill-opacity="{opacity}"/></mask>')
        shapes.append(f'<rect x="{x}" y="{y}" width="16" height="8" fill="#2060C0" mask="url(#m{i})"/>')
        if intermediate:
            shapes[-1] = f'<rect x="{x}" y="{y}" width="16" height="8" fill="{color}" fill-opacity="{opacity}" filter="url(#identity)"/>'
if intermediate:
    defs = ['<filter id="identity" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter>']
fixture.SVG = ('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><defs>'+''.join(defs)+'</defs>'+''.join(shapes)+'</svg>').encode()
fixture.generate()
(folder/'cases.json').write_text(json.dumps(cases, indent=2)+'\n', encoding='utf-8')
