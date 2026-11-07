"""Record independently exported reference glyph origins for the kerning controls."""
from pathlib import Path
import ctypes
import hashlib
import json
import pypdfium2 as pdfium

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/gpos-only-kerning'
cases = []
for pdf in sorted(root.glob('*.pdf')):
    lines = []
    document = pdfium.PdfDocument(pdf)
    assert len(document) == 1
    page = document[0]
    text = page.get_textpage()
    for index in range(text.count_chars()):
        char = text.get_text_range(index, 1)
        if char in '\r\n':
            continue
        x, y = ctypes.c_double(), ctypes.c_double()
        pdfium.raw.FPDFText_GetCharOrigin(text, index, ctypes.byref(x), ctypes.byref(y))
        baseline = page.get_height() - y.value
        if not lines or abs(lines[-1]['baseline'] - baseline) > .5:
            lines.append(dict(text='', baseline=baseline, glyphs=[]))
        lines[-1]['text'] += char
        lines[-1]['glyphs'].append(x.value)
    assert len(lines) == 4
    assert all(line['text'] == 'AVATAR BETA DELTA To Wa fi fl' for line in lines)
    cases.append(dict(file=pdf.name, lines=lines, sha256={
        file.name: hashlib.sha256(file.read_bytes()).hexdigest()
        for file in [pdf, pdf.with_suffix('.docx')]
    }))
assert len(cases) == 10
(root / 'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326', cases=cases), indent=2) + '\n')
