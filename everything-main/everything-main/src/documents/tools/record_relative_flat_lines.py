"""Measure the native reference's red line ink independently of engine geometry."""
from pathlib import Path
import hashlib
import json
import pypdfium2 as pdfium
from PIL import Image

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/relative-flat-lines'
source, pdf = folder / 'flat-lines.docx', folder / 'native.pdf'
doc = pdfium.PdfDocument(pdf)
assert len(doc) == 10
cases = []
for page in doc:
    image = page.render(scale=4).to_pil().convert('RGB')
    # Keep only the fixture's saturated red artwork, excluding black text.
    pixels = image.load()
    mask = Image.new('1', image.size)
    target = mask.load()
    for y in range(image.height):
        for x in range(image.width):
            r,g,b = pixels[x,y]
            if r > 160 and g < 100 and b < 120: target[x,y] = 1
    bounds = mask.getbbox()
    assert bounds
    cases.append(dict(left=bounds[0]/4, top=bounds[1]/4, right=bounds[2]/4, bottom=bounds[3]/4))
record = dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(), pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(), pointsPerPixel=.25, cases=cases)
(folder / 'reference.json').write_text(json.dumps(record, indent=2)+'\n', encoding='utf8')
print(json.dumps(record, indent=2))

