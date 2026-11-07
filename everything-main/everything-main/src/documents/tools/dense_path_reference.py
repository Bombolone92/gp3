"""Extract dense-path geometry from the independent reference PDF."""
from pathlib import Path
import json,hashlib
import pypdfium2 as pdf
ROOT=Path(__file__).resolve().parents[1];folder=ROOT/'tests/fixtures/dense-path'
p=pdf.PdfDocument(folder/'native.pdf');assert len(p)==1
im=p[0].render(scale=4).to_pil().convert('RGB');rows=[]
for y in [140,165,180,210,240,270,300,330,360,375,400]:
 xs=[x for x in range(80*4,420*4) if sum(abs(a-b) for a,b in zip(im.getpixel((x,y*4)),(32,128,96)))<30]
 rows.append(dict(y=y,interval=[min(xs)/4,(max(xs)+1)/4] if xs else None))
(folder/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',sourceSha256=hashlib.sha256((ROOT/'public/fixtures/dense-path.docx').read_bytes()).hexdigest(),commandCount=16386,rows=rows),indent=2)+'\n',encoding='utf-8')
p[0].render(scale=1).to_pil().save('<work>/dense-native.png')
