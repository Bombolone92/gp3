from pathlib import Path
import json,hashlib
import pypdfium2 as pdfium
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/floating-picture-crop'
pdf=folder/'native.pdf';source=root/'public/fixtures/floating-picture-crop.docx'
cases=json.loads((folder/'cases.json').read_text());pages=pdfium.PdfDocument(pdf)
assert len(pages)==1
image=pages[0].render(scale=4).to_pil().convert('RGB');samples=[]
for c in cases:
    for u,v in [(u,v) for u in [.1,.3,.55,.8,.95] for v in [.1,.3,.6,.9]]:
        # Avoid the triangle's diagonal antialias boundary in both renderers.
        if c['id']=='C7' and abs(u+v-1)<.04: continue
        x=c['x']+u*c['width'];y=c['y']+v*c['height']
        samples.append(dict(case=c['id'],x=x,y=y,color=list(image.getpixel((round(x*4),round(y*4))))))
data=dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),referenceVersion='16.0.20326',samples=samples)
(folder/'reference.json').write_text(json.dumps(data,indent=2)+'\n')
