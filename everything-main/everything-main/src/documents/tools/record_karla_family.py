"""Record original Karla controls from an independently exported reference PDF."""
from pathlib import Path
import ctypes
import hashlib
import json
import pypdfium2 as pdfium
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/karla-family'
cases = json.loads((ROOT / 'cases.json').read_text(encoding='utf-8'))
rows = []
pdf = pdfium.PdfDocument(ROOT / 'native.pdf')
for page_index, page in enumerate(pdf):
    text = page.get_textpage()
    for index in range(text.count_chars()):
        char = text.get_text_range(index, 1)
        if char in '\r\n':
            continue
        x, y = ctypes.c_double(), ctypes.c_double()
        pdfium.raw.FPDFText_GetCharOrigin(text, index, ctypes.byref(x), ctypes.byref(y))
        baseline = page.get_height() - y.value
        if not rows or rows[-1]['page'] != page_index or abs(rows[-1]['baseline'] - baseline) > .5:
            rows.append(dict(page=page_index, baseline=baseline, x=x.value, text=''))
        rows[-1]['text'] += char
for row in rows:
    row['text'] = row['text'].rstrip()
assert [row['text'] for row in rows] == [case['text'] for case in cases]
fonts = sorted({str(f.get_object()['/BaseFont']).split('+')[-1] for page in PdfReader(ROOT / 'native.pdf').pages for f in page['/Resources']['/Font'].values()})
result = dict(referenceVersion='16.0.20326', pages=len(pdf), fonts=fonts, rows=rows,
              sha256={name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in ['control.docx', 'native.pdf', 'cases.json']})
(ROOT / 'reference.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
