"""Record stable native reference ink samples for the original diagram controls."""
from pathlib import Path
import hashlib,json
import pypdfium2 as pdf
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/diagram-drawings'
doc=pdf.PdfDocument(folder/'native.pdf');assert len(doc)==3
pages=[]
for page in doc:
    image=page.render(scale=3).to_pil().convert('RGB');samples=[]
    for x in range(25,251,5):
        for y in range(80,206,5):
            color=image.getpixel((x*3,y*3))
            if any(image.getpixel((x*3+dx,y*3+dy))!=color for dx in [-3,0,3] for dy in [-3,0,3]):continue
            samples.append(dict(x=x,y=y,rgb=list(color)))
    pages.append(samples)
result=dict(sourceSha256=hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),pages=pages)
(folder/'reference.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
print(sum(map(len,pages)),'native samples')
