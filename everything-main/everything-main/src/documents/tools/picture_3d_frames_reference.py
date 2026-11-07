"""Record native reference colors and silhouettes independently of renderer code."""
from pathlib import Path
import json,hashlib
import pypdfium2 as pdfium
from pypdf import PdfReader
from PIL import ImageChops
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'tests/fixtures/picture-3d-frames'
cases=json.loads((OUT/'cases.json').read_text()); pdf=pdfium.PdfDocument(OUT/'native.pdf'); raw=PdfReader(OUT/'native.pdf'); pages=[]
assert len(pdf)==len(cases)
for i,c in enumerate(cases):
 im=pdf[i].render(scale=4).to_pil().convert('RGB'); outline=[]; samples=[]
 channels=im.split(); mask=ImageChops.darker(ImageChops.darker(channels[0],channels[1]),channels[2]).point(lambda v:255 if v<240 else 0)
 for y in range(110*4,290*4):
  box=mask.crop((75*4,y,315*4,y+1)).getbbox()
  if box:outline.extend([[75+box[0]/4,y/4],[75+box[2]/4,y/4]])
 for x in range(75*4,315*4):
  box=mask.crop((x,110*4,x+1,290*4)).getbbox()
  if box:outline.extend([[x/4,110+box[1]/4],[x/4,110+box[3]/4]])
 for y in range(123,280,9):
  for x in range(87,303,9):
   samples.append(dict(x=x,y=y,inset=10,edge='grid',palette=sorted({im.getpixel((x*4+dx,y*4+dy)) for dx in range(-5,6) for dy in range(-5,6)})))
 images=[v.get_object() for v in raw.pages[i]['/Resources']['/XObject'].values() if v.get_object().get('/Subtype')=='/Image']
 assert len(images)==1
 pages.append(dict(name=c['name'],samples=samples,outline=outline,imageFilter=str(images[0]['/Filter'])))
result=dict(referenceVersion='16.0.20326',sourceSha256=hashlib.sha256((OUT/'source.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((OUT/'native.pdf').read_bytes()).hexdigest(),pages=pages)
(OUT/'reference.json').write_text(json.dumps(result,separators=(',',':'))+'\n',encoding='utf-8')
print('Recorded',len(pages),'pages')
