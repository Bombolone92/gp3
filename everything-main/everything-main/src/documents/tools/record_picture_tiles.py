"""Record the reference PDF pattern matrices and interior raster samples, independently."""
from pathlib import Path
import json,hashlib
from pypdf import PdfReader
import pypdfium2 as pdfium
ROOT=Path(__file__).resolve().parents[1];folder=ROOT/'tests/fixtures/picture-tiles';path=folder/'native.pdf';pdf=PdfReader(path);raster=pdfium.PdfDocument(path)
colors=[(240,40,30),(30,80,210),(40,170,70),(240,180,20),(255,255,255)];cases=[]
for i,page in enumerate(pdf.pages):
 patterns=list(page['/Resources'].get('/Pattern',{}).values());assert len(patterns)<=1
 pattern=None
 if patterns:
  p=patterns[0].get_object();m=list(map(float,p['/Matrix']));assert m[1]==m[2]==0
  pattern=dict(x=m[4]-36,y=504-m[5]-90,width=m[0]*float(p['/XStep']),height=m[3]*float(p['/YStep']))
 im=raster[i].render(scale=4).to_pil().convert('RGB');samples=[]
 for y in [7,19,31,43,61,83,113,149,197,211]:
  for x in [7,19,31,43,61,83,113,149,197,251,281]:
   rgb=im.getpixel((round((36+x)*4),round((90+y)*4)))
   if any(max(abs(a-b) for a,b in zip(rgb,c))<3 for c in colors):samples.append([x,y,*rgb])
 cases.append(dict(pattern=pattern,samples=samples))
 print(i+1,pattern,'samples',len(samples))
result=dict(sourceSha256=hashlib.sha256((ROOT/'public/fixtures/shape-picture-tiles-reference.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(path.read_bytes()).hexdigest(),nativeReferencePages=len(pdf.pages),cases=cases)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
