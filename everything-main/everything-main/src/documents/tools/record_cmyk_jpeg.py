"""Capture native colors for the original CMYK JPEG controls and image frames."""
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
import json,re,hashlib
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/cmyk-jpeg';source=folder/'control.docx';pdf=folder/'native.pdf'
cases=json.loads((folder/'cases.json').read_text());reader=PdfReader(pdf);render=pdfium.PdfDocument(pdf);pictures=[]
for pageIndex,page in enumerate(reader.pages):
 image=render[pageIndex].render(scale=4).to_pil().convert('RGB')
 render[pageIndex].render(scale=4/3).to_pil().save(folder/f'native-page{pageIndex+1}.png')
 placements=re.findall(r'([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s+/([^\s]+) Do',page.get_contents().get_data().decode('latin1'))
 for w,h,x,y,name in placements:
  w,h,x,y=map(float,(w,h,x,y));top=float(page.mediabox.height)-y-h
  samples=[list(image.getpixel((round((x+w*fx)*4),round((top+h*fy)*4)))) for fy in [.125,.375,.625,.875] for fx in [.125,.375,.625,.875]]
  pictures.append(dict(name=cases['names'][len(pictures)],page=pageIndex,x=x,y=top,width=w,height=h,samples=samples))
assert len(pictures)==2
ref=dict(pages=len(reader.pages),pictures=pictures,referenceVersion='16.0.20326',sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest())
(folder/'reference.json').write_text(json.dumps(ref,indent=2)+'\n')
print([(p['name'],p['samples']) for p in pictures])
