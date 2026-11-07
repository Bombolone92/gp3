"""Record reference PDF pixels and glyph positions; never infer expected colors."""
from pathlib import Path
import hashlib
import json
import sys
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[1]
fixture = 'shape-upright-inactive' if '--upright' in sys.argv else 'shape-defaults'
if '--hidden-fill' in sys.argv: fixture = 'hidden-fill-controls'
if '--inactive-tabs' in sys.argv: fixture = 'shape-inactive-tabs'
if '--inactive-normal-autofit' in sys.argv: fixture = 'inactive-normal-autofit'
folder = ROOT / 'tests/fixtures' / fixture
source = ROOT / 'public/fixtures' / (fixture + '.docx')
pdf = folder / 'native.pdf'
doc = pdfium.PdfDocument(pdf)
assert len(doc) == 1
page = doc[0]
image = page.render(scale=2).to_pil().convert('RGB')
samples = []
for i in range(8):
    x, y = 60 + 260 * (i % 2), 100 + 140 * (i // 2)
    for dx, dy in [(100, 45), (-2, 45), (202, 45), (100, -2), (100, 92)]:
        px, py = x + dx, y + dy
        samples.append(dict(x=px, y=py, color=list(image.getpixel((px * 2, py * 2)))))
text = page.get_textpage()
glyphs = []
for i in range(text.count_chars()):
    c = text.get_text_range(i, 1)
    if c in '\r\n': continue
    l, b, r, t = text.get_charbox(i)
    glyphs.append(dict(text=c, left=l, top=page.get_height()-t, right=r, bottom=page.get_height()-b))
result = dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
              pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(), samples=samples, glyphs=glyphs)
(folder / 'reference.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
