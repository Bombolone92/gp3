"""Record independently exported reference positions; no engine calculations."""
from pathlib import Path
import ctypes
import hashlib
import json
import pypdfium2 as pdfium
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/empty-gpos-kerning'
TEXT = 'AVATAR To Wa controls compare flowing words.'
cases = json.loads((ROOT / 'cases.json').read_text())
result = dict(referenceVersion='16.0.20326', sha256={}, documents=[])
for enabled in [0, 1]:
    name = f'enabled-{enabled}'
    for suffix in ['.docx', '-native.pdf']:
        path = ROOT / (name + suffix)
        result['sha256'][path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    document = pdfium.PdfDocument(ROOT / (name + '-native.pdf'))
    rows = []
    for index, page in enumerate(document):
        text = page.get_textpage(); search = text.search(TEXT)
        while (hit := search.get_next()) is not None:
            x, y = ctypes.c_double(), ctypes.c_double()
            pdfium.raw.FPDFText_GetCharOrigin(text, hit[0], ctypes.byref(x), ctypes.byref(y))
            rows.append(dict(case=len(rows), page=index + 1, x=x.value, baseline=page.get_height() - y.value))
    if len(rows) != len(cases):
        raise ValueError(f'{name}: expected {len(cases)} rows, found {len(rows)}')
    fonts = sorted({str(f.get_object()['/BaseFont']) for p in PdfReader(ROOT / (name + '-native.pdf')).pages for f in p['/Resources']['/Font'].values()})
    result['documents'].append(dict(enabled=enabled, pages=len(document), fonts=fonts, rows=rows))
result['sha256']['cases.json'] = hashlib.sha256((ROOT / 'cases.json').read_bytes()).hexdigest()
(ROOT / 'reference.json').write_text(json.dumps(result, indent=2) + '\n')
