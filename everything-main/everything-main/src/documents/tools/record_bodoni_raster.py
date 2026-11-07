from pathlib import Path
import pypdfium2 as pdf
from PIL import Image,ImageDraw
import numpy as np,json,hashlib
r=Path(__file__).resolve().parents[1]/'tests/fixtures/bodoni-raster';cases=json.loads((r/'cases.json').read_text());doc=pdf.PdfDocument(str(r/'native.pdf'));p=doc[0];tp=p.get_textpage();groups=[]
for i in range(tp.count_chars()):
 c=tp.get_text_range(i,1)
 if not c.strip():continue
 l,b,rr,t=tp.get_charbox(i);top=p.get_height()-t;bottom=p.get_height()-b
 if not groups or top>groups[-1][3]+5:groups.append([l,top,rr,bottom])
 else:g=groups[-1];g[0]=min(g[0],l);g[1]=min(g[1],top);g[2]=max(g[2],rr);g[3]=max(g[3],bottom)
assert len(groups)==len(cases),(len(groups),len(cases))
results=[];sheet=Image.new('RGB',(1200,120*len(cases)),'#ddd');draw=ImageDraw.Draw(sheet)
for ratio in [1,4]:
 native=p.render(scale=ratio*4/3).to_pil().convert('RGB');native.save(r/f'native-{96*ratio}dpi.png');app=Image.open(r/f'browser-{96*ratio}dpi.png').convert('RGB');assert native.size==app.size,(native.size,app.size)
 for c,box in zip(cases,groups):
  x0,y0,x1,y1=box;rect=tuple(int(v*ratio*4/3) for v in [x0-3,y0-3,x1+3,y1+3]);a=np.asarray(app.crop(rect)).astype(float);n=np.asarray(native.crop(rect)).astype(float)
  if c['dark']:bg=np.array([34,44,55]);aa=np.clip((a-bg)/(255-bg),0,1).mean(2);nn=np.clip((n-bg)/(255-bg),0,1).mean(2)
  else:aa=1-a.mean(2)/255;nn=1-n.mean(2)/255
  best=(float('inf'),None)
  for dy in range(-2*ratio,2*ratio+1):
   for dx in range(-2*ratio,2*ratio+1):
    shifted=np.roll(aa,(dy,dx),(0,1));error=float(abs(shifted-nn).sum()/nn.sum())
    if error<best[0]:best=(error,[dx,dy])
  results.append(dict(**c,dpi=96*ratio,inkRatio=float(aa.sum()/nn.sum()),alignedL1=best[0],translation=best[1]))
  if ratio==4:
   for col,im in enumerate([native,app]):
    crop=im.crop(rect);crop.thumbnail((590,92));sheet.paste(crop,(col*600,c['index']*120+24));draw.text((col*600+5,c['index']*120+4),f'{c["family"]} {c["size"]} bold={c["bold"]} dark={c["dark"]} '+('Reference' if col==0 else 'Browser'),fill='black')
sheet.save(r/'raster-pairs.png');(r/'raster-comparison.json').write_text(json.dumps(results,indent=2)+'\n',encoding='utf-8')
(r/'hashes.json').write_text(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in r.iterdir() if p.suffix in ['.docx','.pdf','.png']},indent=2)+'\n',encoding='utf-8')
for v in results:print(v)
