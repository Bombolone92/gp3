"""Record independent reference PDF exports: python tools/record_svg_fill_references.py <capture-directory>."""
from pathlib import Path
from shutil import copyfile
from hashlib import sha256
from pypdf import PdfReader
import json, sys

repo = Path(__file__).resolve().parents[1]
dest = repo / 'tests/fixtures/svg-fill-viewport'
captures = Path(sys.argv[1])
records = {}
for name in ['svg-fill-viewport', 'svg-opacity-values', 'svg-opacity-composition']:
    source = repo / 'public/fixtures' / f'{name}.docx'
    capture = dest / f'{name}-native.pdf'
    copyfile(captures / capture.name, capture)
    pdf = PdfReader(capture)
    form = next(iter(pdf.pages[0]['/Resources']['/XObject'].values())).get_object()
    records[name] = {
        'sourceSha256': sha256(source.read_bytes()).hexdigest(),
        'pdfSha256': sha256(capture.read_bytes()).hexdigest(),
        'referenceVersion': '16.0.20326', 'pages': len(pdf.pages),
        'firstFormBounds': list(form['/BBox']), 'firstFormMatrix': list(form['/Matrix']),
        'firstFormFillAlpha': sorted(set(float(v.get_object().get('/ca', 1))
                                       for v in form['/Resources']['/ExtGState'].values()))
    }
(dest / 'manifest.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')
