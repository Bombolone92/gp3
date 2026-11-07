"""Pin original control packages and extract the installed reference application's line geometry."""
from pathlib import Path
import ctypes
import hashlib
import json
import pypdfium2 as pdf

FOLDER = Path(__file__).resolve().parents[1] / 'tests/fixtures/justification-contraction'
cases = json.loads((FOLDER / 'cases.json').read_text())
result = dict(referenceVersion='16.0.20326', documents={})
for name, spec in cases.items():
    source, native = FOLDER / (name + '.docx'), FOLDER / (name + '-native.pdf')
    pages = []
    for page in pdf.PdfDocument(native):
        text = page.get_textpage()
        lines = []
        for i in range(text.count_chars()):
            char = text.get_text_range(i, 1)
            if char.isspace():
                continue
            x, y = ctypes.c_double(), ctypes.c_double()
            pdf.raw.FPDFText_GetCharOrigin(text, i, ctypes.byref(x), ctypes.byref(y))
            top = page.get_height() - y.value
            if not lines or abs(lines[-1]['y'] - top) > .2:
                lines.append(dict(text='', x=x.value, y=top))
            lines[-1]['text'] += char
        pages.append(lines)
    assert len(pages) == len(spec['cases']), name
    result['documents'][name] = dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
        pdfSha256=hashlib.sha256(native.read_bytes()).hexdigest(), pages=pages)
(FOLDER / 'reference.json').write_text(json.dumps(result, indent=2) + '\n')
print(sum(len(d['pages']) for d in result['documents'].values()), 'native pages recorded')
