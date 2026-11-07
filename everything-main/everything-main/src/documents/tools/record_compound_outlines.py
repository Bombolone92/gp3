"""Record stable reference raster samples around all eight compound outlines."""
from pathlib import Path
import hashlib
import json
import sys
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[1]
ellipse = '--ellipse' in sys.argv
half = '--half' in sys.argv
name = 'shape-compound-ellipses' if ellipse else 'shape-compound-outlines'
if half: name += '-half'
if '--default-width' in sys.argv: name = 'shape-outline-default-width'
folder = ROOT / 'tests/fixtures' / name
source = ROOT / f'public/fixtures/{name}.docx'
pdf = folder / 'native.pdf'
doc = pdfium.PdfDocument(pdf)
assert len(doc) == 1
im = doc[0].render(scale=4).to_pil().convert('RGB')
samples = []
for i in range(8):
    x, y = 60 + 260 * (i % 2), 100 + 140 * (i // 2)
    width, height = (100,45) if half else (200,90)
    for dx in range(-6, width+7, 3):
        for dy in range(-6, height+7, 3):
            if ellipse:
                radius = ((dx-width/2)/(width/2))**2 + ((dy-height/2)/(height/2))**2
                if not (.3 if half else .6) < radius < (2 if half else 1.5): continue
            elif 7 < dx < width-7 and 7 < dy < height-7: continue
            px, py = (x + dx) * 4, (y + dy) * 4
            color = im.getpixel((px, py))
            if all(im.getpixel((px+a, py+b)) == color for a in range(-3,4) for b in range(-3,4)):
                samples.append(dict(x=x+dx, y=y+dy, color=list(color)))
(folder / 'reference.json').write_text(json.dumps(dict(
    sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
    pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(), samples=samples), indent=2)+'\n')
print(len(samples), 'stable native reference samples')
