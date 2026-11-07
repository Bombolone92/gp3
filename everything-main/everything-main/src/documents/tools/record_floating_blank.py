"""Record the installed reference application's baselines and pin the independent source/PDF pair."""
from pathlib import Path
import ctypes
import hashlib
import json
import pypdfium2 as pdf

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/floating-blank-lines'
pages = []
for page in pdf.PdfDocument(root / 'native.pdf'):
    text = page.get_textpage()
    chars = text.get_text_range()
    result = {}
    for label in ['Before', 'After']:
        index = chars.index(label)
        x, y = ctypes.c_double(), ctypes.c_double()
        pdf.raw.FPDFText_GetCharOrigin(text, index, ctypes.byref(x), ctypes.byref(y))
        result[label] = page.get_height() - y.value
    pages.append(result)
reference = dict(referenceVersion='16.0.20326', pages=pages,
    sourceSha256=hashlib.sha256((root/'source.docx').read_bytes()).hexdigest(),
    pdfSha256=hashlib.sha256((root/'native.pdf').read_bytes()).hexdigest())
(root/'reference.json').write_text(json.dumps(reference, indent=2)+'\n')
