"""Capture original junction controls with flat material to isolate outline error.

Requires the installed reference application, Arial, Franklin Gothic Book, and a running app.
Usage: python tools/compare_text_3d_flat_outlines.py SCRATCH [URL]
Only the material changes; the app still uses its 3D outline rasterizer.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import subprocess
import sys
import numpy as np
from PIL import Image
from lxml import etree
import pypdfium2 as pdfium

repo = Path(__file__).resolve().parents[1]
output = Path(sys.argv[1]).resolve()
url = sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:5173/playground.html'
output.mkdir(parents=True, exist_ok=True)
with ZipFile(repo / 'tests/fixtures/text-3d/junctions.docx') as source:
    parts = {name: source.read(name) for name in source.namelist()}
document = etree.fromstring(parts['word/document.xml'])
changed = 0
for element in document.iter():
    for key in element.attrib:
        if etree.QName(key).localname == 'prstMaterial':
            element.set(key, 'flat')
            changed += 1
assert changed == 6
parts['word/document.xml'] = etree.tostring(document)
with ZipFile(output / 'control.docx', 'w', ZIP_DEFLATED) as archive:
    for name, data in parts.items():
        archive.writestr(name, data)
subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                str(repo / 'tools/export-reference.ps1'), '-SourceFullPath',
                str(output / 'control.docx'), '-OutputPdf', str(output / 'native.pdf')], check=True)
subprocess.run(['node', str(repo / 'tools/capture-text3d-junctions.mjs'),
                str(output), url, str(output / 'control.docx')], check=True)

def ink(image):
    return (image[:, :, 0] > 130) & (image[:, :, 1] < 100) & (image[:, :, 2] < 120)

def dilate(mask):
    padded = np.pad(mask, 1)
    return np.logical_or.reduce([
        padded[y:y + mask.shape[0], x:x + mask.shape[1]]
        for y in range(3) for x in range(3)
    ])

pdf = pdfium.PdfDocument(str(output / 'native.pdf'))
assert len(pdf) == 6
records = []
for index in range(6):
    word = np.asarray(pdf[index].render(scale=4).to_pil().convert('RGB'))
    app = np.asarray(Image.open(output / f'text3d-junction-page{index + 1}.png').convert('RGB'))
    assert word.shape == app.shape
    native_mask, app_mask = ink(word), ink(app)
    ys, xs = np.where(native_mask | app_mask)
    box = tuple(map(int, (xs.min() - 8, ys.min() - 8, xs.max() + 9, ys.max() + 9)))
    x0, y0, x1, y1 = box
    native_mask, app_mask = native_mask[y0:y1, x0:x1], app_mask[y0:y1, x0:x1]
    native_expanded, app_expanded = native_mask.copy(), app_mask.copy()
    counts = []
    for radius in range(9):
        counts.append(int(np.count_nonzero(native_mask & ~app_expanded) +
                          np.count_nonzero(app_mask & ~native_expanded)))
        native_expanded, app_expanded = dilate(native_expanded), dilate(app_expanded)
    records.append(dict(page=index + 1, nativeInk=int(native_mask.sum()),
                        appInk=int(app_mask.sum()), unmatchedPixelsByRadius=counts))
    pair = Image.new('RGB', ((x1 - x0) * 2, y1 - y0), 'white')
    pair.paste(Image.fromarray(word).crop(box), (0, 0))
    pair.paste(Image.fromarray(app).crop(box), (x1 - x0, 0))
    pair.thumbnail((1000, 900))
    pair.save(output / f'pair{index + 1}.png')
(output / 'outline-comparison.json').write_text(json.dumps(records, indent=2))
print(json.dumps(records, indent=2))
