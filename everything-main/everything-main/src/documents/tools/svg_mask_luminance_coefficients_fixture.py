"""Original color pairs distinguishing two near-equal mask luminance matrices."""
from pathlib import Path
import json
import canvas_svg_fixture as fixture

root = Path(__file__).resolve().parents[1]
name = 'svg-mask-luminance-coefficients'
folder = root / 'tests/fixtures' / name
folder.mkdir(exist_ok=True)
fixture.SOURCE = root / 'public/fixtures' / (name + '.docx')
colors = [(30, 255, 10), (225, 0, 245), (90, 255, 55), (165, 0, 200), (25, 250, 5), (230, 5, 250)]
defs, shapes, cases = [], [], []
for i, color in enumerate(colors):
    x = 2 + i * 20
    css = '#%02x%02x%02x' % color
    defs.append(f'<mask id="m{i}" maskUnits="userSpaceOnUse" x="{x}" y="10" width="16" height="60"><rect x="{x}" y="10" width="16" height="60" fill="{css}"/></mask>')
    shapes.append(f'<rect x="{x}" y="10" width="16" height="60" fill="#2060c0" mask="url(#m{i})"/>')
    candidates = [sum(c * k for c, k in zip(color, matrix)) for matrix in [(0.2126, 0.7152, 0.0722), (0.2125, 0.7154, 0.0721)]]
    assert int(candidates[0] + .5) != int(candidates[1] + .5)
    cases.append({'rgb': color, 'candidateLuminance': candidates})
fixture.SVG = ('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><defs>' + ''.join(defs) + '</defs>' + ''.join(shapes) + '</svg>').encode()
fixture.generate()
(folder / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')
