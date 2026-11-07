"""Extract native reference text and visible colored-rule samples."""
from pathlib import Path
import json, hashlib
import pypdfium2 as pdfium
from pypdf import PdfReader
root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/merged-border-ownership'
source=folder/'controls.docx';pdf=folder/'native.pdf'
names=json.loads((folder/'cases.json').read_text())
reader=PdfReader(pdf);render=pdfium.PdfDocument(pdf);cases=[]
def colored(rgb):return max(rgb)-min(rgb)>40
for index,(name,page) in enumerate(zip(names,reader.pages)):
 texts=[]
 def visit(t,cm,tm,f,size):
  if t.strip() in ['Merged','R0','R1','R2','After']:texts.append(dict(text=t.strip(),x=float(tm[4]),y=792-float(tm[5])))
 page.extract_text(visitor_text=visit)
 image=render[index].render(scale=3).to_pil().convert('RGB');samples=[]
 for x in [110,250]:
  for y in range(84,156):
   ink=colored(image.getpixel((x*3,y*3)))
   if all(colored(image.getpixel((x*3+dx,y*3+dy)))==ink for dx in [-1,0,1] for dy in [-1,0,1]):samples.append(dict(x=x,y=y,ink=ink))
 cases.append(dict(name=name,texts=texts,samples=samples))
result=dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),cases=cases)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
