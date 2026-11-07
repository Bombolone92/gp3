"""Sample the independent native reference shape-shadow controls, excluding sharp ink edges."""
from pathlib import Path
import hashlib,json
import pypdfium2 as pdf
from PIL import ImageChops

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/shape-shadows'
cases=json.loads((folder/'cases.json').read_text(encoding='utf-8'))
doc=pdf.PdfDocument(folder/'native.pdf');assert len(doc)==len(cases)
images=[p.render(scale=4).to_pil().convert('RGB') for p in doc]
box=(320,460,1720,1480)
for a,b in [(0,2),(0,4),(3,5),(7,8)]:
    assert ImageChops.difference(images[a].crop(box),images[b].crop(box)).getbbox() is None
pages=[]
for image,case in zip(images,cases):
    samples=[]
    for x in range(110,394,8):
        for y in range(145,318,8):
            color=image.getpixel((x*4,y*4))
            neighbors=[image.getpixel((x*4+dx,y*4+dy)) for dx in [-3,0,3] for dy in [-3,0,3]]
            if any(max(abs(a-b) for a,b in zip(color,n))>12 for n in neighbors):continue
            samples.append(dict(x=x,y=y,rgb=list(color)))
    pages.append(dict(name=case['name'],samples=samples))
result=dict(sourceSha256=hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest(),
            pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),pages=pages)
(folder/'reference.json').write_text(json.dumps(result,separators=(',',':'))+'\n',encoding='utf-8')
print('PASS four exact native region comparisons;',sum(len(p['samples']) for p in pages),'samples')
