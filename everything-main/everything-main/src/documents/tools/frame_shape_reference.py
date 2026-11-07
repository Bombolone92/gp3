"""Record independent reference pixels across frame borders, openings and pin limits."""
from pathlib import Path
import hashlib
import json
import pypdfium2 as pdfium
root = Path(__file__).resolve().parents[1]
folder = root/'tests/fixtures/frame-shapes'
source = root/'public/fixtures/frame-shapes.docx'
pdf = folder/'native.pdf'
document = pdfium.PdfDocument(pdf)
assert len(document) == 1
image = document[0].render(scale=3).to_pil().convert('RGB')
samples = []
for i in range(8):
    x, y = 60+260*(i%2), 100+140*(i//2)
    # Stay clear of glyphs and antialiased boundaries. Sweep both axes to
    # distinguish short-side thickness from scaling each side independently.
    points = [(dx,70) for dx in [-2,2,5,8,10,13,20,25,40,60,100,160,180,190,195,198,202]]
    points += [(170,dy) for dy in [-2,2,5,8,10,13,20,25,40,60,70,80,85,88,92]]
    for dx,dy in points:
        px,py=x+dx,y+dy
        samples.append(dict(x=px,y=py,color=list(image.getpixel((px*3,py*3)))))
result = dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),samples=samples)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
