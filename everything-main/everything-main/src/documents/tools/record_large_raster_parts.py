from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
import json,re,hashlib
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/large-raster-parts';source=folder/'control.docx';pdf=folder/'native.pdf'
cases=json.loads((folder/'cases.json').read_text());reader=PdfReader(pdf);render=pdfium.PdfDocument(pdf);case=0
for pageIndex,page in enumerate(reader.pages):
 image=render[pageIndex].render(scale=4).to_pil().convert('RGB')
 render[pageIndex].render(scale=4/3).to_pil().save(folder/f'native-page{pageIndex+1}.png')
 placements=re.findall(r'([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s+/([^\s]+) Do',page.get_contents().get_data().decode('latin1'))
 for w,h,x,y,name in placements:
  w,h,x,y=map(float,(w,h,x,y));top=float(page.mediabox.height)-y-h
  colors=[list(image.getpixel((round((x+w*f)*4),round((top+h/2)*4)))) for f in [.25,.75]]
  cases[case].update(page=pageIndex,x=x,y=top,frameWidth=w,frameHeight=h,colors=colors);case+=1
assert case==len(cases)
data=dict(cases=cases,referenceVersion='16.0.20326',sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest())
(folder/'reference.json').write_text(json.dumps(data,indent=2)+'\n')
print([(c['name'],c['bytes'],c['colors']) for c in cases])
