"""Measure native raster ink, including clipped-away glyphs and later text."""
from pathlib import Path
from hashlib import sha256
import json
import pypdfium2 as P

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/emf-dual-clip'
doc=P.PdfDocument(folder/'native.pdf');assert len(doc)==1
im=doc[0].render(scale=4).to_pil().convert('RGB')
cases=json.loads((folder/'cases.json').read_text())
for i,case in enumerate(cases):
    x,y=60+260*(i%2),100+140*(i//2)
    case['regions']=[]
    for top,bottom in [(y,y+50),(y+50,y+90)]:
        bounds=[x,top,x+200,bottom];ink=0;points=[]
        for py in range(top*4,bottom*4):
            for px in range(x*4,(x+200)*4):
                r,g,b=im.getpixel((px,py))
                if b>r+20 and r<180:
                    ink+=1-(r+g+b)/765
                    points.append((px,py))
        box=[min(p[0] for p in points)/4,min(p[1] for p in points)/4,
             (max(p[0] for p in points)+1)/4,(max(p[1] for p in points)+1)/4] if points else None
        case['regions'].append(dict(bounds=bounds,ink=ink,box=box))
out=dict(referenceVersion='16.0.20326',sourceSha256=sha256((folder/'control.docx').read_bytes()).hexdigest(),
         pdfSha256=sha256((folder/'native.pdf').read_bytes()).hexdigest(),cases=cases)
(folder/'reference.json').write_text(json.dumps(out,indent=2)+'\n')
