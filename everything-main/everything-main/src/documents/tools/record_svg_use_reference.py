"""Record native reference SVG reuse geometry; never derive expected values from JS."""
from pathlib import Path
from hashlib import sha256
import json
import sys
from pypdf import PdfReader
from pypdf.generic import ContentStream

root = Path(__file__).resolve().parents[1]
styles = '--styles' in sys.argv
source = root / ('public/fixtures/svg-use-styles.docx' if styles else 'public/fixtures/svg-use-pictures.docx')
pdf = root / ('tests/fixtures/svg-use/styles-native.pdf' if styles else 'tests/fixtures/svg-use/native.pdf')
reader = PdfReader(pdf)
forms = []
for name, ref in reader.pages[0]['/Resources']['/XObject'].items():
    obj = ref.get_object()
    if obj.get('/Subtype') != '/Form':
        continue
    ops = ContentStream(obj, reader).operations
    colors, stack, color = [], [], [0, 0, 0]
    for values, op in ops:
        if op == b'q': stack.append(color[:])
        elif op == b'Q': color = stack.pop()
        elif op == b'rg': color = [float(v) for v in values]
        elif op == b'g': color = [float(values[0])] * 3
        elif op in [b'f', b'f*']: colors.append(color[:])
    forms.append({
        'name': str(name), 'bounds': list(obj['/BBox']), 'matrix': list(obj['/Matrix']),
        'geometry': [{'operator': op.decode('ascii'), 'values': [float(v) for v in values]}
                     for values, op in ops if op in [b're', b'm', b'l', b'w']],
        'fillAlpha': sorted({float(v.get_object().get('/ca', 1))
                             for v in obj.get('/Resources', {}).get('/ExtGState', {}).values()}),
        'fillColors': colors,
    })
assert len(reader.pages) == 1 and len(forms) == 2
if not styles:
    assert all(any(o['operator'] == 'w' and o['values'] == [.14]
                   for o in form['geometry']) for form in forms)
record = {'referenceVersion': '16.0.20326', 'pages': len(reader.pages),
          'sourceSha256': sha256(source.read_bytes()).hexdigest(),
          'pdfSha256': sha256(pdf.read_bytes()).hexdigest(), 'forms': forms}
(pdf.parent / ('styles-reference.json' if styles else 'reference.json')).write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print('Recorded two native SVG forms, including paint colors and geometry.')
