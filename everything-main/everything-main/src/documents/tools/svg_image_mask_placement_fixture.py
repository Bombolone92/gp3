"""Original mask controls separating fractional extents and translations."""
from pathlib import Path
from io import BytesIO
import base64
import argparse
import json
from PIL import Image
import canvas_svg_fixture as fixture

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--sweep', action='store_true', help='Probe eighth-pixel and exact half-pixel horizontal phases')
parser.add_argument('--output-dir', type=Path)
args = parser.parse_args()
folder = args.output_dir or Path(__file__).resolve().parents[1] / 'tests/fixtures' / ('svg-image-mask-placement-sweep' if args.sweep else 'svg-image-mask-placement')
folder.mkdir(parents=True, exist_ok=True)
cases = [
    dict(name='integer', width=20, height=64, x=-2, y=-2),
    dict(name='fractional-size', width=20.5, height=64.75, x=-2, y=-2),
    dict(name='fractional-x', width=20.5, height=64.75, x=-2.25, y=-2),
    dict(name='fractional-y', width=20.5, height=64.75, x=-2, y=-2.25),
    dict(name='fractional-both', width=20.5, height=64.75, x=-1.25, y=-2.125),
    dict(name='fractional-other-phase', width=20.5, height=64.75, x=-1.75, y=-1.625),
]
if args.sweep:
    cases = [dict(name=f'x-{x}', width=20.5, height=64.75, x=x, y=-2) for x in [-2.5, -2.375, -2.125, -1.875, -1.625, -1.5]]
image = Image.new('RGB', (40, 128))
for y in range(image.height):
    for x in range(image.width):
        image.putpixel((x, y), (32 + 96 * ((x // 4) % 2) + 96 * ((y // 12) % 2),) * 3)
stream = BytesIO()
image.save(stream, format='PNG')
uri = 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode()
definitions, shapes = [], []
for i, case in enumerate(cases):
    x = 2 + i * 20
    definitions.append(f'<mask id="m{i}" maskUnits="userSpaceOnUse" x="{x}" y="10" width="16" height="60">'
                       f'<image x="{x + case["x"]}" y="{10 + case["y"]}" width="{case["width"]}" height="{case["height"]}" '
                       f'preserveAspectRatio="none" href="{uri}"/></mask>')
    shapes.append(f'<rect x="{x}" y="10" width="16" height="60" fill="#2060C0" mask="url(#m{i})"/>')
fixture.SOURCE = folder / 'control.docx'
fixture.SVG = ('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">'
               '<defs>' + ''.join(definitions) + '</defs>' + ''.join(shapes) + '</svg>').encode()
fixture.generate()
(folder / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
