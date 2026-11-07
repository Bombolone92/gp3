"""Extract independent reference baseline measurements for the original control."""
from pathlib import Path
import ctypes
import hashlib
import json
import pypdfium2 as pdfium

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/exact-font-baseline'
lines = []
for page_index, page in enumerate(pdfium.PdfDocument(folder / 'native.pdf')):
    text = page.get_textpage()
    for i in range(text.count_chars()):
        char = text.get_text_range(i, 1)
        if char in '\r\n': continue
        x, y = ctypes.c_double(), ctypes.c_double()
        pdfium.raw.FPDFText_GetCharOrigin(text, i, ctypes.byref(x), ctypes.byref(y))
        baseline = round(page.get_height() - y.value, 4)
        if not lines or lines[-1]['page'] != page_index or abs(lines[-1]['baseline'] - baseline) > .5:
            lines.append(dict(page=page_index, baseline=baseline, text=''))
        lines[-1]['text'] += char
result = dict(sourceSha256=hashlib.sha256((root / 'public/fixtures/exact-font-baseline.docx').read_bytes()).hexdigest(), pdfSha256=hashlib.sha256((folder / 'native.pdf').read_bytes()).hexdigest(), lines=lines)
(folder / 'positions.json').write_text(json.dumps(result, indent=2) + '\n')
