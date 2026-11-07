from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image,ImageDraw
import pypdfium2 as pdfium
import sys
from zipfile import ZipFile
from xml.etree import ElementTree
root=Path(sys.argv[1])
fixture=root
pdf=pdfium.PdfDocument(str(fixture/'native.pdf'))
with ZipFile(fixture/'control.docx') as source:
 document=ElementTree.fromstring(source.read('word/document.xml'))
cases=[dict(name=node.text) for node in document.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t') if (node.text or '').startswith('Original ')]
assert len(cases)==len(pdf)==5
records=[]
for index,case in enumerate(cases):
 word=np.asarray(pdf[index].render(scale=4).to_pil().convert('RGB'))
 app=np.asarray(Image.open(root/f'text3d-junction-page{index+1}.png').convert('RGB'))
 ink=(word[:,:,0]>130)&(word[:,:,1]<100)&(word[:,:,2]<120)
 ys,xs=np.where(ink);samples=[];bad=[]
 for y in range(int(ys.min())+2,int(ys.max())-2,4):
  for x in range(int(xs.min())+2,int(xs.max())-2,4):
   rgb=word[y,x].astype(int)
   if ink[y,x] and np.max(abs(word[y-1:y+2,x-1:x+2].astype(int)-rgb))<=1:
    actual=app[y,x].astype(int);error=int(max(abs(actual-rgb)))
    sample=dict(x=x/4,y=y/4,rgb=rgb.tolist(),actual=actual.tolist(),error=error)
    samples.append(sample)
    if error>4:bad.append(sample)
 box=(int(xs.min())-4,int(ys.min())-4,int(xs.max())+5,int(ys.max())+5)
 a=Image.fromarray(word).crop(box);b=Image.fromarray(app).crop(box)
 a.thumbnail((400,500));b=b.resize(a.size)
 out=Image.new('RGB',(a.width*2,a.height+25),'white');out.paste(a,(0,25));out.paste(b,(a.width,25))
 ImageDraw.Draw(out).text((3,3),case['name']+' | Native / App',fill='black')
 out.save(root/f'text3d-junction-crop{index+1}.png')
 records.append(dict(**case,page=index+1,samples=len(samples),failures=len(bad),maxError=max(s['error'] for s in samples),bad=bad))
result=dict(sourceSha256=hashlib.sha256((fixture/'control.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((fixture/'native.pdf').read_bytes()).hexdigest(),records=records)
(root/'text3d-junction-comparison.json').write_text(json.dumps(result,indent=2))
print(json.dumps([{k:v for k,v in r.items() if k!='bad'} for r in records],indent=2))
