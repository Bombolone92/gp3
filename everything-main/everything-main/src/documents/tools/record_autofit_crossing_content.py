"""Record native filled-cell bounds, independently of browser layout."""
from pathlib import Path
import ctypes
import hashlib
import json
import sys
import pypdfium2 as pdfium

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/autofit-crossing-content'
colors = {(255, 170, 170): 'left', (170, 255, 170): 'spacer',
          (170, 170, 255): 'right', (255, 255, 170): 'bottomLeft',
          (170, 255, 255): 'bottomRight'}
cases = json.loads((folder / 'cases.json').read_text())
name = sys.argv[1] if len(sys.argv) > 1 else 'control'
assert name in ['control', 'wide']
pdf_name = 'native.pdf' if name == 'control' else 'wide-native.pdf'
pages = []
with pdfium.PdfDocument(folder / pdf_name) as document:
    assert len(document) == len(cases)
    for page in document:
        cells = {}
        for obj in page.get_objects():
            if obj.type != pdfium.raw.FPDF_PAGEOBJ_PATH:
                continue
            channels = [ctypes.c_uint() for _ in range(4)]
            pdfium.raw.FPDFPageObj_GetFillColor(obj.raw, *[ctypes.byref(c) for c in channels])
            label = colors.get(tuple(c.value for c in channels[:3]))
            if label is None:
                continue
            left, bottom, right, top = obj.get_bounds()
            width = right - left
            if label not in cells or width > cells[label]['width']:
                cells[label] = dict(x=left, width=width)
        assert set(cells) == set(colors.values())
        pages.append(cells)
result = dict(referenceBuild='16.0.20326', pages=pages, hashes={
    name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
    for name in [f'{name}.docx', pdf_name, 'cases.json']})
(folder / ('reference.json' if name == 'control' else 'wide-reference.json')).write_text(json.dumps(result, indent=2) + '\n')
for case, page in zip(cases, pages):
    print(case, {k: round(v['width'], 3) for k, v in page.items()})
