"""Native reference PDF character origins for the original HYPERLINK control."""
from pathlib import Path
import ctypes, hashlib, json
import pypdfium2 as pdf
root = Path(__file__).resolve().parents[1] / 'tests/fixtures/hyperlink-fields'
pages = []
for page in pdf.PdfDocument(root / 'native.pdf'):
    text = page.get_textpage()
    lines = []
    for i in range(text.count_chars()):
        char = text.get_text_range(i, 1)
        if not char.strip(): continue
        x, y = ctypes.c_double(), ctypes.c_double()
        pdf.raw.FPDFText_GetCharOrigin(text, i, ctypes.byref(x), ctypes.byref(y))
        top = page.get_height() - y.value
        if not lines or abs(lines[-1]['y'] - top) > .15:
            lines.append(dict(text='', x=x.value, y=top))
        lines[-1]['text'] += char
    pages.append(lines)
(root / 'reference.json').write_text(json.dumps(dict(referenceBuild='16.0.20326',
    sourceSha256=hashlib.sha256((root/'control.docx').read_bytes()).hexdigest(),
    pdfSha256=hashlib.sha256((root/'native.pdf').read_bytes()).hexdigest(), pages=pages), indent=2)+'\n')
