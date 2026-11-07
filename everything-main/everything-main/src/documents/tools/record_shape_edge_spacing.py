"""Record independent reference PDF ink bands and text baselines."""
from pathlib import Path
import hashlib,json
import pypdfium2 as pdfium
from pypdf import PdfReader
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/shape-edge-spacing'
source=root/'public/fixtures/shape-edge-spacing.docx';pdf=folder/'native.pdf'
cases=json.loads((folder/'cases.json').read_text());doc=pdfium.PdfDocument(pdf);baselines={}
for page in PdfReader(pdf).pages:
 def visitor(text,cm,tm,font,size):
  if text.strip().startswith('E'):baselines.setdefault(text.strip().split()[0],[]).append(float(page.mediabox.height)-tm[5])
 page.extract_text(visitor_text=visitor)
for page in range(len(doc)):
 im=doc[page].render(scale=4).to_pil().convert('RGB')
 for c in [c for c in cases if c['page']==page]:
  x,y=c['x'],c['y'];bands=[]
  for py in range(y*4,(y+110)*4):
   if any(b>r+25 and b>g+12 and r<100 for r,g,b in (im.getpixel((px,py)) for px in range(x*4,(x+200)*4))):
    if not bands or py>bands[-1][1]+1:bands.append([py,py])
    else:bands[-1][1]=py
  c.update(bands=[[a/4,(b+1)/4] for a,b in bands],baselines=baselines[c['id']])
(folder/'reference.json').write_text(json.dumps(dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),referenceVersion='16.0.20326',cases=cases),indent=2)+'\n')
