"""Record independent reference pixel samples and visible bounds."""
from pathlib import Path
import hashlib,json
import pypdfium2 as pdfium
from PIL import ImageChops,Image
ROOT=Path(__file__).resolve().parents[1];folder=ROOT/'tests/fixtures/group-rotation'
pdf=pdfium.PdfDocument(folder/'native.pdf');assert len(pdf)==8
palette=[(224,32,48),(32,160,80),(32,80,208),(224,176,32)]
cases=[]
for page_index in range(8):
    im=pdf[page_index].render(scale=4).to_pil().convert('RGB')
    for row in range(2):
        center=210+330*row;samples=[]
        for x in range(150,470,16):
            for y in range(center-152,center+153,16):
                rgb=im.getpixel((x*4,y*4))
                if rgb not in palette+[(255,255,255)]:continue
                if all(im.getpixel((x*4+dx,y*4+dy))==rgb for dx in [-8,0,8] for dy in [-8,0,8]):samples.append([x,y,*rgb])
        # Threshold chroma rather than exact colors to include antialiased edges.
        crop=im.crop((100*4,(center-160)*4,510*4,(center+160)*4));r,g,b=crop.split()
        chroma=ImageChops.subtract(ImageChops.lighter(ImageChops.lighter(r,g),b),ImageChops.darker(ImageChops.darker(r,g),b)).point(lambda v:255 if v>50 else 0)
        l,t,rr,bb=chroma.getbbox()
        cases.append(dict(page=page_index,samples=samples,bounds=[100+l/4,center-160+t/4,100+rr/4,center-160+bb/4]))
result=dict(sourceSha256=hashlib.sha256((ROOT/'public/fixtures/group-rotation.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),cases=cases)
(folder/'reference.json').write_text(json.dumps(result,separators=(',',':'))+'\n',encoding='utf-8')
