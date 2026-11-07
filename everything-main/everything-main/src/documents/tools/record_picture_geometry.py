"""Read stable color samples from the independent reference geometry PDF."""
from pathlib import Path
import hashlib, json
import pypdfium2 as pdfium
ROOT=Path(__file__).resolve().parents[1]; folder=ROOT/'tests/fixtures/picture-geometry'
pdf=pdfium.PdfDocument(folder/'native.pdf'); assert len(pdf)==1
im=pdf[0].render(scale=4).to_pil().convert('RGB'); samples=[]
for i in range(12):
    for dx in range(6,144,12):
        for dy in range(6,72,12):
            x,y=60+260*(i%2)+dx,90+108*(i//2)+dy
            rgb=im.getpixel((x*4,y*4))
            # Avoid antialiased boundaries; test both image and clipped regions.
            if all(im.getpixel((x*4+sx,y*4+sy))==rgb for sx in [-4,0,4] for sy in [-4,0,4]):
                samples.append(dict(x=x,y=y,color=list(rgb),case=i+1))
result=dict(sourceSha256=hashlib.sha256((ROOT/'public/fixtures/picture-geometry.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),samples=samples)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
