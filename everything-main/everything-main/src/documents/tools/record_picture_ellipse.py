from pathlib import Path
import json,hashlib,re
from pypdf import PdfReader
import pypdfium2 as pdfium
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/picture-ellipse'
pdf=folder/'native.pdf';source=root/'public/fixtures/picture-ellipse.docx'
cases=json.loads((folder/'cases.json').read_text());pages=pdfium.PdfDocument(pdf)
assert len(pages)==2
last=PdfReader(pdf).pages[1];placements=re.findall(r'([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s+/[^\s]+ Do',last.get_contents().get_data().decode('latin1'));assert len(placements)==1
w,h,x,y=map(float,placements[0]);cases[-1].update(x=x,y=float(last.mediabox.height)-y-h,width=w,height=h)
images=[page.render(scale=4).to_pil().convert('RGB') for page in pages];samples=[]
for c in cases:
    image=images[c['page']]
    for u,v in [(u,v) for u in [-.025,.1,.3,.55,.8,.95,1.025] for v in [-.025,.1,.3,.6,.9,1.025]]:
        # Exclude ellipse-edge antialiasing; retain stable inside/outside points.
        if abs((2*u-1)**2+(2*v-1)**2-1)<.08: continue
        x=c['x']+u*c['width'];y=c['y']+v*c['height']
        samples.append(dict(case=c['id'],page=c['page'],x=x,y=y,color=list(image.getpixel((round(x*4),round(y*4))))))
data=dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),referenceVersion='16.0.20326',samples=samples)
(folder/'reference.json').write_text(json.dumps(data,indent=2)+'\n')
