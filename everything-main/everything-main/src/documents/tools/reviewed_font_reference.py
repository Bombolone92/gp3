"""Record native reference glyph positions independently of browser shaping."""
from pathlib import Path
import ctypes
import hashlib
import json
import sys
import pypdfium2 as pdfium

root = Path(__file__).resolve().parents[1]
fixture = sys.argv[1] if len(sys.argv) > 1 else 'reviewed-font'
folder = root / 'tests/fixtures' / fixture
pdf = folder / 'native.pdf'
pages = []
for page in pdfium.PdfDocument(pdf):
    text, lines = page.get_textpage(), []
    for i in range(text.count_chars()):
        char = text.get_text_range(i, 1)
        if char in '\r\n':
            continue
        x, y = ctypes.c_double(), ctypes.c_double()
        pdfium.raw.FPDFText_GetCharOrigin(text, i, ctypes.byref(x), ctypes.byref(y))
        baseline = round(page.get_height() - y.value, 4)
        if not lines or abs(lines[-1]['baseline'] - baseline) > .5:
            lines.append(dict(baseline=baseline, text='', glyphs=[]))
        lines[-1]['text'] += char
        lines[-1]['glyphs'].append(round(x.value, 4))
    for line in lines:
        line['text'] = line['text'].rstrip()
        line['glyphs'] = line['glyphs'][:len(line['text'])]
    pages.append(sorted(lines, key=lambda line: line['baseline']))
result = dict(sourceSha256=hashlib.sha256((root / 'public/fixtures' / f'{fixture}.docx').read_bytes()).hexdigest(), pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(), pages=pages)
(folder / 'reference.json').write_text(json.dumps(result, indent=2) + '\n')
