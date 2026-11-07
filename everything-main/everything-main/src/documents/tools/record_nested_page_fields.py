"""Record independent reference PDF lines and source hashes for both field controls."""
from pathlib import Path
import ctypes
import hashlib
import json
import pypdfium2 as pdf

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/nested-page-fields'
records = []
for source, reference in [('control.docx', 'native.pdf'), ('locked.docx', 'locked-native.pdf')]:
    doc = pdf.PdfDocument(root / reference)
    pages = []
    for page in doc:
        text = page.get_textpage()
        lines = []
        for i in range(text.count_chars()):
            char = text.get_text_range(i, 1)
            if not char.strip():
                continue
            x, y = ctypes.c_double(), ctypes.c_double()
            pdf.raw.FPDFText_GetCharOrigin(text, i, ctypes.byref(x), ctypes.byref(y))
            top = page.get_height() - y.value
            if not lines or abs(lines[-1]['y'] - top) > .15:
                lines.append(dict(text='', x=x.value, y=top))
            lines[-1]['text'] += char
        pages.append(lines)
    records.append(dict(source=source, sourceSha256=hashlib.sha256((root/source).read_bytes()).hexdigest(),
                        pdf=reference, pdfSha256=hashlib.sha256((root/reference).read_bytes()).hexdigest(), pages=pages))
(root / 'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326', cases=records), indent=2)+'\n')
