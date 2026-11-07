"""Measure the original reference PDF; never import application rendering code."""
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
import json, re, hashlib
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/picture-grayscale'
source=root/'public/fixtures/picture-grayscale.docx';pdf=folder/'native.pdf'
data=json.loads((folder/'cases.json').read_text());reader=PdfReader(pdf);render=pdfium.PdfDocument(pdf);case=0
for pageIndex,page in enumerate(reader.pages):
    image=render[pageIndex].render(scale=4).to_pil().convert('RGB')
    placements=re.findall(r'([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s+/([^\s]+) Do',page.get_contents().get_data().decode('latin1'))
    for w,h,x,y,name in placements:
        w,h,x,y=map(float,(w,h,x,y));top=float(page.mediabox.height)-y-h
        samples=[list(image.getpixel((round((x+w*(i+.5)/16)*4),round((top+h/2)*4)))) for i in range(16)]
        data['cases'][case].update(page=pageIndex,x=x,y=top,width=w,height=h,colors=samples)
        print(data['cases'][case]['id'],data['cases'][case]['label'],samples)
        case+=1
assert case==len(data['cases'])
data.update(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),referenceVersion='16.0.20326')
(folder/'reference.json').write_text(json.dumps(data,indent=2)+'\n')
