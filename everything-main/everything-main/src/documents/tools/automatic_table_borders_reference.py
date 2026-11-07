"""Extract native reference automatic-border samples on light and dark pages."""
from pathlib import Path
import hashlib,json
import pypdfium2 as pdfium
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/automatic-table-borders'
for suffix in ['', '-dark']:
 source=folder/f'controls{suffix}.docx';pdf=folder/f'native{suffix}.pdf';doc=pdfium.PdfDocument(pdf);pages=[]
 for page in doc:
  im=page.render(scale=3).to_pil().convert('RGB')
  spans=[];start=None
  for y in range(36*3,650*3):
   black=max(im.getpixel((35*3,y)))<4
   if black and start is None:start=y
   if not black and start is not None:
    if y-start>30:spans.append((start/3,y/3))
    start=None
  assert len(spans)==4,spans
  samples=[]
  for top,bottom in spans:
   # Sample stroke centers, not antialiased edges; geometry has separate controls.
   for y in [top+2,top+18,(top+bottom)/2,bottom-18,bottom-2]:
    for x in [36,100,180,250,324]:
     # Outer T-junction raster seams are an existing, separately recorded gap.
     # Retain horizontal/vertical stroke centers and the central intersection.
     if x in [36,324] and y==(top+bottom)/2:continue
     px,py=round(x*3),round(y*3);color=im.getpixel((px,py))
     if all(im.getpixel((px+dx,py+dy))==color for dx in [-1,0,1] for dy in [-1,0,1]):samples.append(dict(x=x,y=y,color=list(color)))
  pages.append(samples)
 ref=dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),pages=pages)
 (folder/f'native{suffix}-reference.json').write_text(json.dumps(ref,indent=2)+'\n',encoding='utf-8')
 print(suffix,len(pages),sum(map(len,pages)))
