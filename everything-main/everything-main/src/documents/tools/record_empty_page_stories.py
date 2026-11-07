from pathlib import Path
import json,hashlib
import pypdfium2 as pdfium
from pypdf import PdfReader
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/empty-page-stories';result={}
for name,suffix in [('plain',''),('shaded','-shaded')]:
 source=root/f'public/fixtures/empty-page-stories{suffix}.docx';pdf=folder/f'{name}-native.pdf';doc=pdfium.PdfDocument(pdf);assert len(doc)==3
 bands=[]
 for page in doc:
  im=page.render(scale=2).to_pil().convert('RGB');rows=[]
  for y in range(im.height):
   if im.getpixel((1000,y))==(34,170,136):rows.append(y)
  groups=[]
  for y in rows:
   if not groups or y>groups[-1][-1]+1:groups.append([])
   groups[-1].append(y)
  bands.append([dict(top=g[0]/2,bottom=(g[-1]+1)/2) for g in groups])
 result[name]=dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),bands=bands,text=[p.extract_text().strip() for p in PdfReader(pdf).pages])
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
