"""Record the font actually painting U+2028 and independent native baselines."""
import argparse
import ctypes
import hashlib
import json
import re
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdf

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory', type=Path)
root = parser.parse_args().directory
cases = json.loads((root / 'cases.json').read_text())
reader = PdfReader(root / 'native.pdf')
document = pdf.PdfDocument(root / 'native.pdf')
if len(reader.pages) != len(cases) or len(document) != len(cases):
    raise ValueError('Expected one native page per case')
rows = []
for index, case in enumerate(cases):
    glyphs = []

    def visit(text, cm, tm, font, size):
        if '\u2028' in text:
            if text.count('\u2028') != 1 or not font:
                raise ValueError('Ambiguous separator font')
            glyphs.append(dict(font=re.sub(r'^/[A-Z]{6}\+', '', str(font['/BaseFont'])), size=size))

    reader.pages[index].extract_text(visitor_text=visit)
    if len(glyphs) != 1:
        raise ValueError(f'Expected one painted separator: {case["label"]}')
    page = document[index]
    text = page.get_textpage()
    baselines = []
    for label in ['Start', 'Sample', 'Tail']:
        found = text.search(label).get_next()
        if not found:
            raise ValueError(f'Missing native line {label}')
        x, y = ctypes.c_double(), ctypes.c_double()
        if not pdf.raw.FPDFText_GetCharOrigin(text, found[0], ctypes.byref(x), ctypes.byref(y)):
            raise ValueError('Missing native character origin')
        baselines.append(page.get_height() - y.value)
    rows.append(dict(case=case['label'], page=index + 1, separator=glyphs[0], baselines=baselines))
reference = dict(referenceVersion='16.0.20326', pages=len(document), rows=rows,
                 sha256={name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in ['control.docx', 'cases.json', 'native.pdf']})
(root / 'reference.json').write_text(json.dumps(reference, indent=2) + '\n')
print(json.dumps(rows, indent=2))
