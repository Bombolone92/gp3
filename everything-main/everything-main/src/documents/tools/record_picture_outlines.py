"""Native reference samples for picture textures and separately painted outlines."""
from pathlib import Path
import hashlib,json
import pypdfium2 as pdfium
ROOT=Path(__file__).resolve().parents[1];folder=ROOT/'tests/fixtures/picture-outlines'
pdf=pdfium.PdfDocument(folder/'native.pdf');assert len(pdf)==1
im=pdf[0].render(scale=4).to_pil().convert('RGB');samples=[];outlines=[]
for i in range(12):
    for dx in range(-6,151,6):
        for dy in range(-6,79,6):
            x,y=60+260*(i%2)+dx,90+108*(i//2)+dy
            rgb=im.getpixel((x*4,y*4))
            # One point of native flat color avoids texture interpolation at
            # crop boundaries, as in the existing picture-geometry control.
            if all(im.getpixel((x*4+sx,y*4+sy))==rgb for sx in [-4,0,4] for sy in [-4,0,4]):
                samples.append(dict(x=x,y=y,color=list(rgb),case=i+1))
    # Include physical outline bounds to catch clipped strokes or scaled pens.
    x0,y0=(60+260*(i%2)-8)*4,(90+108*(i//2)-8)*4
    points=[]
    for y in range(88*4):
        for x in range(160*4):
            if im.getpixel((x0+x,y0+y))==(192,32,208):points.append((x,y))
    assert points,(i,'missing outline')
    outlines.append(dict(case=i+1,left=(x0+min(x for x,y in points))/4,top=(y0+min(y for x,y in points))/4,right=(x0+max(x for x,y in points)+1)/4,bottom=(y0+max(y for x,y in points)+1)/4))
result=dict(referenceBuild='16.0.20326',sourceSha256=hashlib.sha256((ROOT/'public/fixtures/picture-outlines.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),samples=samples,outlines=outlines)
(folder/'reference.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
print(len(samples),'stable native samples;',len(outlines),'outline bounds')
