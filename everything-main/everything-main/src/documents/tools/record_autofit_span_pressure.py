"""Extract native cell-fill widths for the unresolved AutoFit controls."""
from pathlib import Path
import ctypes
import hashlib
import json
import pypdfium2 as pdfium

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/autofit-span-pressure'
colors = {(255, 170, 170): 'left', (170, 255, 170): 'spacer',
          (170, 170, 255): 'right', (255, 255, 170): 'bottomLeft',
          (170, 255, 255): 'bottomRight'}
result = {}
for name in ['legacy', 'modern', 'series']:
    doc = pdfium.PdfDocument(folder / f'{name}-native.pdf')
    pages = []
    for page in doc:
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
            # The native reference paints smaller text backgrounds in addition to whole-cell
            # fills. Keep the widest rectangle of each unique cell color.
            if label not in cells or width > cells[label]['width']:
                cells[label] = dict(x=left, width=width)
        assert {'left', 'spacer', 'right'} <= cells.keys()
        pages.append(cells)
    result[name] = dict(referenceBuild='16.0.20326', pages=pages, hashes={
        file: hashlib.sha256((folder / file).read_bytes()).hexdigest()
        for file in [f'{name}.docx', f'{name}-native.pdf']})
(folder / 'reference.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
