"""Record reference PDF pixels and glyph positions; never infer expected colors."""
from pathlib import Path
import hashlib
import json
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[1]
folder = ROOT / 'tests/fixtures/shape-alpha'
source = ROOT / 'public/fixtures/shape-alpha.docx'
pdf = folder / 'native.pdf'
doc = pdfium.PdfDocument(pdf)
assert len(doc) == 1
page = doc[0]
image = page.render(scale=2).to_pil().convert('RGB')
samples = []
for i in range(12):
    x, y = 60 + 260 * (i % 2), 100 + 100 * (i // 2)
    for dx, dy in [(70, 20), (-2, 20), (146, 20), (70, -2), (70, 42)]:
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

