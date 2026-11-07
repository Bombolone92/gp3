"""Bind native PDF line origins and package hashes for section field controls."""
from pathlib import Path
import ctypes
import hashlib
import json
import pypdfium2 as pdf

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/section-fields'
cases = []
for name in ['continuous', 'next-page', 'boundaries']:
    document = pdf.PdfDocument(ROOT / f'{name}-native.pdf')
    rows = []
    for page_no, page in enumerate(document):
        text = page.get_textpage()
        for i in range(text.count_chars()):
            label = text.get_text_range(i, 3)
            if label not in [f'C{n:02}' for n in range(1, 22)]:
                continue
            x, y = ctypes.c_double(), ctypes.c_double()
            assert pdf.raw.FPDFText_GetCharOrigin(text, i, ctypes.byref(x), ctypes.byref(y))
            rows.append(dict(label=label, page=page_no, x=x.value, baseline=page.get_height()-y.value))
    assert len(rows) == (13 if name == 'boundaries' else 21), (name, rows)
    cases.append(dict(name=name, pages=len(document), lines=rows, sha256={
        f: hashlib.sha256((ROOT / f).read_bytes()).hexdigest()
        for f in [f'{name}.docx', f'{name}-native.pdf']}))
(ROOT / 'reference.json').write_text(json.dumps(cases, indent=2)+'\n')
