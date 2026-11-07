"""Record native corner-preset ink and text origins."""
import sys
kind=sys.argv[1]
from pathlib import Path
import json, hashlib
import pypdfium2 as pdfium
from pypdf import PdfReader
root=Path(__file__).resolve().parents[1]
folder=root/f'tests/fixtures/corner-{kind}'
source=root/f'public/fixtures/corner-{kind}.docx'
pdf=folder/'native.pdf'
doc=pdfium.PdfDocument(pdf)
assert len(doc)==1
page=doc[0]
bitmap=page.render(scale=3)
image=bitmap.to_pil().convert('RGB')
bitmap.close();page.close();doc.close()
samples=[]
for i in range(8):
 x,y=60+260*(i%2),100+140*(i//2)
 for dx in range(-20,221,8):
  for dy in range(-30,121,8):
   px,py=x+dx,y+dy
   color=image.getpixel((px*3,py*3))
   if color not in [(34,136,68),(255,255,255)]: continue
   # Keep independently selected samples away from antialiasing and text.
   if any(image.getpixel((px*3+sx,py*3+sy))!=color for sx in range(-3,4) for sy in range(-3,4)): continue
   samples.append(dict(x=px,y=py,color=list(color)))
texts=[]
def visit(text,cm,tm,font,size):
 if text.strip()=='Inset text': texts.append(dict(text=text.strip(),x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4],y=tm[4]*cm[1]+tm[5]*cm[3]+cm[5]))
PdfReader(pdf).pages[0].extract_text(visitor_text=visit)
result=dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),samples=samples,texts=texts)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(len(samples),texts)
