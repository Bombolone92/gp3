"""Extract the independent reference fixture's printed lines and origins."""
from pathlib import Path
import ctypes
import hashlib
import json
import pypdfium2 as pdfium

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/retained-story-controls'
pdf = folder / 'native.pdf'
pages = []
for page in pdfium.PdfDocument(pdf):
    text = page.get_textpage()
    lines = []
    for i in range(text.count_chars()):
        char = text.get_text_range(i, 1)
        if char in '\r\n':
            continue
        x, y = ctypes.c_double(), ctypes.c_double()
        pdfium.raw.FPDFText_GetCharOrigin(text, i, ctypes.byref(x), ctypes.byref(y))
        baseline = round(page.get_height() - y.value, 4)
        if not lines or abs(lines[-1]['baseline'] - baseline) > .5:
            lines.append(dict(x=round(x.value, 4), baseline=baseline, text=''))
        lines[-1]['text'] += char
    for line in lines:
        line['text'] = line['text'].rstrip()
    pages.append(sorted(lines, key=lambda line: line['baseline']))
result = dict(sourceSha256=hashlib.sha256((root / 'public/fixtures/retained-story-controls.docx').read_bytes()).hexdigest(), pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(), pages=pages)
(folder / 'reference.json').write_text(json.dumps(result, indent=2) + '\n')
