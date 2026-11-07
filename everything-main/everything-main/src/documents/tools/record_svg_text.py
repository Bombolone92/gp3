"""Record reference SVG text ink relative to the picture frame, in SVG pixels."""
from pathlib import Path
import hashlib,json
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import ImageChops
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/svg-text'
pdf=folder/'native.pdf'; reader=PdfReader(pdf); rendered=pdfium.PdfDocument(pdf)
assert len(reader.pages)==14
cases=[]
for i,page in enumerate(reader.pages):
 frames=[list(map(float,a)) for a,o in page.get_contents().operations if o==b're' and abs(float(a[2])-225)<.1 and abs(float(a[3])-90)<.1]
 assert frames
 x,y,w,h=frames[-1];top=float(page.mediabox.height)-y-h
 r,g,b=rendered[i].render(scale=4).to_pil().convert('RGB').split()
 mask=ImageChops.multiply(r.point(lambda v:255 if v>160 else 0),g.point(lambda v:255 if v<100 else 0))
 mask=ImageChops.multiply(mask,b.point(lambda v:255 if v<120 else 0));box=mask.getbbox();assert box
 fonts=[str(f.get_object().get('/BaseFont')) for obj in page['/Resources']['/XObject'].values() for f in obj.get_object().get('/Resources',{}).get('/Font',{}).values()]
 cases.append(dict(left=(box[0]/4-x)*300/w,top=(box[1]/4-top)*120/h,right=(box[2]/4-x)*300/w,bottom=(box[3]/4-top)*120/h,fonts=fonts))
record=dict(sourceSha256=hashlib.sha256((folder/'svg-text.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),cases=cases)
(folder/'reference.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf8')
print(json.dumps(record,indent=2))
