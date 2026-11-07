from pathlib import Path
import hashlib,json
import pypdfium2 as pdfium
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/narrow-cell-roundoff'
pdf=folder/'native.pdf';doc=pdfium.PdfDocument(pdf);assert len(doc)==1
im=doc[0].render(scale=4).to_pil().convert('RGB');points=[]
for y in range(im.height):
 for x in range(im.width):
  if im.getpixel((x,y))==(34,170,136):points.append((x,y))
assert points
result=dict(pages=len(doc),greenLeft=min(x for x,y in points)/4,greenRight=(max(x for x,y in points)+1)/4,sourceSha256=hashlib.sha256((root/'public/fixtures/narrow-cell-roundoff.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest())
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n');print(result)
