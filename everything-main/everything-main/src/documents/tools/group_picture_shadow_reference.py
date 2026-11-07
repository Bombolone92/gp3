"""Sample the independent native reference shape-shadow controls, excluding sharp ink edges."""
from pathlib import Path
import hashlib,json
import pypdfium2 as pdf
from PIL import ImageChops

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/group-picture-shadows'
cases=json.loads((folder/'cases.json').read_text(encoding='utf-8'))
doc=pdf.PdfDocument(folder/'native.pdf');assert len(doc)==len(cases)
images=[]
for index in range(len(doc)):
 page=doc[index];bitmap=page.render(scale=4);images.append(bitmap.to_pil().convert('RGB'));bitmap.close();page.close()
doc.close()
pages=[]
for image,case in zip(images,cases):
    samples=[]
    for x in range(80,340,5):
        for y in range(110,310,5):
            color=image.getpixel((x*4,y*4))
            # Exclude a 2pt neighborhood around sharp texture/outline edges. The
            # native reference and Canvas use different reconstruction filters on the 40px PNG.
            neighbors=[image.getpixel((x*4+dx,y*4+dy)) for dx in [-8,-4,0,4,8] for dy in [-8,-4,0,4,8]]
            if any(max(abs(a-b) for a,b in zip(color,n))>12 for n in neighbors):continue
            samples.append(dict(x=x,y=y,rgb=list(color)))
    region=image.crop((80*4,110*4,340*4,310*4))
    red,green,blue=region.split()
    mask=ImageChops.darker(ImageChops.darker(red,green),blue).point(lambda v:255 if v<230 else 0)
    box=mask.getbbox();bounds=[80+box[0]/4,110+box[1]/4,80+box[2]/4,110+box[3]/4]
    pages.append(dict(name=case['name'],samples=samples,bounds=bounds))
result=dict(sourceSha256=hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest(),
            pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),pages=pages)
(folder/'reference.json').write_text(json.dumps(result,separators=(',',':'))+'\n',encoding='utf-8')
print('Native grouped-picture shadow samples:',sum(len(p['samples']) for p in pages),'samples')
