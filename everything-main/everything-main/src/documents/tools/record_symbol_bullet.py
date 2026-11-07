"""Record original reference bullet ink relative to its text baseline."""
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
import json,hashlib
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/symbol-bullet'
source=root/'public/fixtures/symbol-bullet.docx';pdf=folder/'native.pdf'
cases=json.loads((folder/'cases.json').read_text());baselines={}
for page in PdfReader(pdf).pages:
 def visit(text,cm,tm,font,size):
  if text.strip().startswith('S'):baselines[text.strip().split()[0]]=792-tm[5]
 page.extract_text(visitor_text=visit)
doc=pdfium.PdfDocument(pdf)
for i in range(len(doc)):
 im=doc[i].render(scale=4).to_pil().convert('RGB')
 for c in [c for c in cases if c['page']==i]:
  baseline=baselines[c['id']];points=[(x,y) for y in range(round((baseline-25)*4),round((baseline+3)*4)) for x in range(70*4,95*4) if max(im.getpixel((x,y)))<100]
  assert points
  c.update(baseline=baseline,ink=[min(x for x,y in points)/4-72,min(y for x,y in points)/4-baseline,(max(x for x,y in points)+1)/4-72,(max(y for x,y in points)+1)/4-baseline],area=len(points)/16)
(folder/'reference.json').write_text(json.dumps(dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),referenceVersion='16.0.20326',cases=cases),indent=2)+'\n')
