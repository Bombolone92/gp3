"""Measure visible text ink in independently exported reference controls."""
from pathlib import Path
import hashlib
import json
import pypdfium2 as pdfium

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/shape-exact-spacing'
source = root / 'public/fixtures/shape-exact-spacing.docx'
pdf = folder / 'native.pdf'
doc = pdfium.PdfDocument(pdf)
assert len(doc) == 1
im = doc[0].render(scale=4).to_pil().convert('RGB')
cases = []
for i in range(8):
    x, y = 60 + 260 * (i % 2), 100 + 140 * (i // 2)
    rows = []
    for py in range(y * 4, (y + 110) * 4):
        if any(b > r + 25 and b > g + 12 and r < 100
               for r, g, b in (im.getpixel((px, py)) for px in range(x * 4, (x + 200) * 4))):
            rows.append(py)
    bands = []
    for py in rows:
        if not bands or py > bands[-1][1] + 1: bands.append([py, py])
        else: bands[-1][1] = py
    cases.append(dict(x=x, y=y, bands=[[a / 4, (b + 1) / 4] for a, b in bands]))
(folder / 'reference.json').write_text(json.dumps(dict(
    sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
    pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(), cases=cases), indent=2) + '\n')
im.resize((612, 792)).save(folder / 'native.png')
