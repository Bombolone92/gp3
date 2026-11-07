from pathlib import Path
import json,hashlib
import pypdfium2 as pdfium
from PIL import Image,ImageChops
root=Path(__file__).resolve().parents[1]; folder=root/'tests/fixtures/zero-cell-spacing'
cases=json.loads((folder/'cases.json').read_text());pdf=pdfium.PdfDocument(folder/'native.pdf');pages=[]
assert len(pdf)==len(cases)
for i,c in enumerate(cases):
 im=pdf[i].render(scale=4).to_pil().convert('RGB');bounds={}
 for color in ['C9E7B5','DDEEFF']:
  bands=ImageChops.difference(im,Image.new('RGB',im.size,'#'+color)).split()
  mask=ImageChops.lighter(ImageChops.lighter(bands[0],bands[1]),bands[2]).point(lambda v:255 if v==0 else 0)
  box=mask.getbbox();assert box;bounds[color]=[v/4 for v in box]
 pages.append(dict(name=c['name'],bounds=bounds))
print(json.dumps(pages,indent=2))
result=dict(referenceVersion='16.0.20326',sourceSha256=hashlib.sha256((folder/'source.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),pages=pages)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
