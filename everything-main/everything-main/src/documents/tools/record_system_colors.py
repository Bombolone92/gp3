"""Record independent reference PDF interior colors; never derive expectations from the renderer."""
from pathlib import Path
from hashlib import sha256
from zipfile import ZipFile
import json,sys,shutil
import pypdfium2 as pdfium
from lxml import etree as E
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'public/fixtures/system-colors.docx'
target=ROOT/'tests/fixtures/system-colors';target.mkdir(parents=True,exist_ok=True)
pdf=Path(sys.argv[1]);shutil.copyfile(pdf,target/'native.pdf')
doc=pdfium.PdfDocument(pdf);assert len(doc)==1
im=doc[0].render(scale=1).to_pil().convert('RGB')
with ZipFile(source) as z:root=E.fromstring(z.read('word/document.xml'))
colors=root.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/main}sysClr');assert len(colors)==36
samples=[];cases=[]
for i,n in enumerate(colors):
 x=36+90*(i%6);y=70+120*(i//6)
 for dx in [20,40,60]:
  for dy in [20,40,60]:samples.append({'x':x+dx,'y':y+dy,'color':list(im.getpixel((x+dx,y+dy))),'translucent':any(E.QName(c).localname=='alpha' and c.get('val')!='100000' for c in n)})
 cases.append({'name':n.get('val'),'lastClr':n.get('lastClr'),'color':list(im.getpixel((x+40,y+40)))})
(target/'reference.json').write_text(json.dumps({'sourceSha256':sha256(source.read_bytes()).hexdigest(),'pdfSha256':sha256(pdf.read_bytes()).hexdigest(),'cases':cases,'samples':samples},indent=2)+'\n')
print('Recorded',len(cases),'reference controls and',len(samples),'interior samples')
