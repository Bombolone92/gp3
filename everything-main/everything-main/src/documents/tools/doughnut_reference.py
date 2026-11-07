"""Record reference chart-frame samples, measured independently of engine layout."""
from pathlib import Path
from zipfile import ZipFile
import json,hashlib,ctypes
from lxml import etree as E
from pypdf import PdfReader
from pypdf.generic import ContentStream
import pypdfium2 as pdfium
ROOT=Path(__file__).resolve().parents[1];folder=ROOT/'tests/fixtures/doughnut-charts'
source=ROOT/'public/fixtures/doughnut-charts.docx';pdfpath=folder/'native.pdf'
with ZipFile(source) as z:r=E.fromstring(z.read('word/document.xml'))
ns={'wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}
frames=list(r.iter('{'+ns['wp']+'}inline'));reader=PdfReader(pdfpath);pdf=pdfium.PdfDocument(pdfpath)
assert len(frames)==len(reader.pages)==len(pdf)
palette=[(224,32,48),(32,160,80),(32,80,208),(224,176,32),(255,255,255)]
cases=[]
for i,frame in enumerate(frames):
 extent=frame.find('wp:extent',ns);width=int(extent.get('cx'))/12700;height=int(extent.get('cy'))/12700
 rects=[list(map(float,args)) for args,op in ContentStream(reader.pages[i].get_contents(),reader).operations if op==b're' and abs(float(args[2])-width)<.01 and abs(float(args[3])-height)<.01]
 assert rects
 x,y,w,h=rects[0];top=pdf[i].get_height()-y-h;im=pdf[i].render(scale=4).to_pil().convert('RGB');samples=[]
 for dx in range(4,round(width)-3,8):
  for dy in range(4,round(height)-3,8):
   px=round((x+dx)*4);py=round((top+dy)*4);rgb=im.getpixel((px,py))
   if rgb in palette and all(im.getpixel((px+ox,py+oy))==rgb for ox in [-3,0,3] for oy in [-3,0,3]):samples.append([dx,dy,*rgb])
 title=[];text=pdf[i].get_textpage()
 for n in range(text.count_chars()):
  ch=text.get_text_range(n,1)
  if ch in '\r\n':continue
  px,py=ctypes.c_double(),ctypes.c_double();pdfium.raw.FPDFText_GetCharOrigin(text,n,ctypes.byref(px),ctypes.byref(py))
  yy=pdf[i].get_height()-py.value
  if top+1<yy<top+height-1 and ch.strip():title.append([ch,round(px.value-x,4),round(yy-top,4)])
 cases.append(dict(name=frame.find('wp:docPr',ns).get('name'),frame=[x,top,width,height],samples=samples,title=title))
(folder/'reference.json').write_text(json.dumps(dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdfpath.read_bytes()).hexdigest(),cases=cases),separators=(',',':'))+'\n')
print('Recorded',len(cases),'native chart controls and',sum(len(c['samples']) for c in cases),'stable pixel samples')
