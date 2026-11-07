"""Extract independent native reference line origins from the embedded controls."""
from pathlib import Path
from pypdf import PdfReader
import hashlib, json
import pypdfium2 as pdfium
import ctypes
root = Path(__file__).resolve().parents[1] / 'tests/fixtures/embedded-fonts'
reference = {}
for pdf in root.glob('*-native.pdf'):
    name = pdf.stem.removesuffix('-native')
    pages = []
    for page in PdfReader(pdf).pages:
        rows = []
        def visit(text, ctm, matrix, font, size):
            if text.strip(): rows.append(dict(text=text.strip(), x=matrix[4], baseline=float(page.mediabox.height)-matrix[5], font=str(font.get('/BaseFont'))))
        page.extract_text(visitor_text=visit)
        pages.append(rows)
    native = pdfium.PdfDocument(pdf)
    for index, page in enumerate(native):
        text = page.get_textpage()
        for row in pages[index]: row['glyphs'] = []
        for i in range(text.count_chars()):
            char = text.get_text_range(i, 1)
            if char in '\r\n': continue
            x, y = ctypes.c_double(), ctypes.c_double()
            pdfium.raw.FPDFText_GetCharOrigin(text, i, ctypes.byref(x), ctypes.byref(y))
            row = min(pages[index], key=lambda r: abs(r['baseline'] - (page.get_height() - y.value)))
            if len(row['glyphs']) < len(row['text']): row['glyphs'].append(x.value)
    reference[name] = dict(pages=pages, sha256={f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in [pdf, root / (name + '.docx')]})
(root / 'reference.json').write_text(json.dumps(reference, indent=2) + '\n')
