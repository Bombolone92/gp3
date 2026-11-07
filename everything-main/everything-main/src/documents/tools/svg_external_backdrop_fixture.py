"""Original transparent SVG control for compositing onto an external backdrop."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
import canvas_svg_fixture as fixture

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/svg-external-backdrop'
OUT.mkdir(parents=True, exist_ok=True)
cases = []; shapes = []
for row, (color, opacity) in enumerate((c, a) for c in ['4080C0', '5A9493', 'FED19F', 'A77E53'] for a in [.1, .3]):
    shapes.append(f'<rect y="{row*10}" width="120" height="10" fill="#{color}" opacity="{opacity}"/>')
    cases.append(dict(row=row, color=color, opacity=opacity))
shapes += ['<rect y="80" width="120" height="10" fill="#FED19F" opacity=".3"/>',
           '<rect y="80" width="120" height="10" fill="#A77E53" opacity=".1"/>']
cases.append(dict(row=8, color='FED19F', opacity=.3, overlay=dict(color='A77E53', opacity=.1)))
fixture.SOURCE = OUT / 'control.docx'
fixture.SVG = ('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90">'+''.join(shapes)+'</svg>').encode()
fixture.generate()
with ZipFile(fixture.SOURCE) as archive:
    parts = {n: archive.read(n) for n in archive.namelist()}
with ZipFile(fixture.SOURCE, 'w') as archive:
    for name, data in parts.items():
        info = ZipInfo(name, (2026, 9, 27, 12, 0, 0)); info.create_system = 0; info.external_attr = 0o600 << 16
        archive.writestr(info, data, compress_type=ZIP_DEFLATED)
(OUT / 'cases.json').write_text(json.dumps(cases, indent=2)+'\n', encoding='utf8')
