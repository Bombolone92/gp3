"""Extract line ink independently from the installed reference PDF."""
from pathlib import Path
import json,hashlib,sys
import pypdfium2 as pdf
ROOT=Path(__file__).resolve().parents[1];name=sys.argv[1] if len(sys.argv)>1 else 'preset-lines';folder=ROOT/f'tests/fixtures/{name}'
p=pdf.PdfDocument(folder/'native.pdf');assert len(p)==1
im=p[0].render(scale=4).to_pil().convert('RGB')
cases=json.loads((folder/'cases.json').read_text())
for case in cases:
 x,y=case['x'],case['y'];pts=[];rows=[]
 for yy in range((y-20)*4,(y+100)*4):
  for xx in range((x-30)*4,(x+150)*4):
   if sum(abs(a-b) for a,b in zip(im.getpixel((xx,yy)),(32,128,96)))<30:pts.append((xx,yy))
 case['bounds']=[min(a for a,b in pts)/4,min(b for a,b in pts)/4,(max(a for a,b in pts)+1)/4,(max(b for a,b in pts)+1)/4] if pts else None
 for axis,at in [('y',y+20),('y',y+40),('y',y+60),('x',x+30),('x',x+60),('x',x+90)]:
  hits=[a if axis=='y' else b for a,b in pts if (b if axis=='y' else a)==at*4]
  rows.append(dict(axis=axis,at=at,interval=[min(hits)/4,(max(hits)+1)/4] if hits else None))
 case['sections']=rows
(folder/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',sourceSha256=hashlib.sha256((ROOT/f'public/fixtures/{name}.docx').read_bytes()).hexdigest(),cases=cases),indent=2)+'\n',encoding='utf-8')
