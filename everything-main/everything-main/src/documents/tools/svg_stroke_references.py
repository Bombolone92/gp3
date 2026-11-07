"""Package independent reference captures and extract their PDF stroke widths.

Usage: python tools/svg_stroke_references.py <directory containing *-native.pdf/xml>
Requires the permissively licensed pypdf library; no external renderer is used.
"""
from pathlib import Path
from shutil import copyfile
from hashlib import sha256
import json, sys
from pypdf import PdfReader
from pypdf.generic import ContentStream

root = Path(__file__).resolve().parents[1]
captures = Path(sys.argv[1])
out = root / 'tests/fixtures/svg-strokes'
out.mkdir(parents=True, exist_ok=True)
names = ['svg-strokes', 'svg-strokes-viewbox', 'svg-strokes-double-size',
         'svg-strokes-scaled', 'svg-strokes-group', 'svg-strokes-primitives']
records, hashes = {}, {}
for name in names:
    source = root / 'public/fixtures' / (name + '.docx')
    hashes[source.name] = sha256(source.read_bytes()).hexdigest()
    for suffix in ['-native.pdf', '-native.xml']:
        target = out / (name + suffix)
        copyfile(captures / target.name, target)
        hashes[target.name] = sha256(target.read_bytes()).hexdigest()
    pdf = PdfReader(out / (name + '-native.pdf'))
    form = next(iter(pdf.pages[0]['/Resources']['/XObject'].values())).get_object()
    width, widths, rect = None, [], None
    for operands, operator in ContentStream(form, pdf).operations:
        if operator == b'w': width = float(operands[0])
        if operator == b're' and rect is None: rect = list(map(float, operands))
        if operator in [b'S', b's', b'B', b'B*']: widths.append(width)
    units = rect[2] / (12 if name == 'svg-strokes-primitives' else 16)
    records[name] = {'pdfWidths': widths, 'pdfUnitsPerSvgUnit': units,
                     'svgWidths': [w / units for w in widths]}
(out / 'widths.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')
(out / 'manifest.json').write_text(json.dumps(hashes, indent=2) + '\n', encoding='utf-8')
print(json.dumps(records, indent=2))
