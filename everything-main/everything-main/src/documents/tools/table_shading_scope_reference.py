"""Record independent reference raster samples, without deriving expected colors."""
from pathlib import Path
import hashlib,json
import pypdfium2 as pdfium
root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/table-shading-scope'
pdf=folder/'native.pdf';source=root/'public/fixtures/table-shading-scope.docx'
doc=pdfium.PdfDocument(pdf)
assert len(doc)==5
samples=[]
for page in range(len(doc)):
    image=doc[page].render(scale=2).to_pil().convert('RGB')
    for x,y in [(100,100),(320,100)]:
        samples.append(dict(page=page,x=x,y=y,color=list(image.getpixel((x*2,y*2)))))
result=dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),samples=samples)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(samples))
