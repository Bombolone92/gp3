"""Extract the reference's colored curve cross-sections independently of engine geometry."""
from pathlib import Path
import json, hashlib, sys
import pypdfium2 as pdf
ROOT=Path(__file__).resolve().parents[1]
name=sys.argv[1] if len(sys.argv)>1 else 'bezier-paths'
folder=ROOT/f'tests/fixtures/{name}'
d=pdf.PdfDocument(folder/'native.pdf');assert len(d)==1
im=d[0].render(scale=4).to_pil().convert('RGB')
cases=json.loads((folder/'cases.json').read_text())
for case in cases:
 rows=[]
 for delta in [-10,15,25,51,75,90,99,110]:
  y=round((case['y']+delta)*4); intervals=[]
  for x in range(round((case['x']-60)*4),round((case['x']+180)*4)):
   if sum(abs(a-b) for a,b in zip(im.getpixel((x,y)),(32,128,96)))<30:
    if intervals and x<=intervals[-1][1]+1:intervals[-1][1]=x+1
    else:intervals.append([x,x+1])
  rows.append(dict(y=y/4,intervals=[[l/4,r/4] for l,r in intervals]))
 case['rows']=rows
(folder/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',sourceSha256=hashlib.sha256((ROOT/f'public/fixtures/{name}.docx').read_bytes()).hexdigest(),cases=cases),indent=2)+'\n',encoding='utf-8')
