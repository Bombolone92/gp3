from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
import hashlib,json,ctypes
repo=Path(__file__).resolve().parents[1]
work=repo/'tests/fixtures/border-corners'
cases=[]
for name,pdf in [('border-frame-only-top',work/'frame-only-top-native.pdf'),('border-frame-only-bottom',work/'frame-only-bottom-native.pdf'),('border-corner-colors',work/'colors-native.pdf'),('border-frame-only-left',work/'frame-only-left-native.pdf'),('border-frame-only-right',work/'frame-only-right-native.pdf'),('compound-border-controls',repo/'tests/fixtures/compound-borders/compound-border-controls-native.pdf'),('compound-border-frame',repo/'tests/fixtures/compound-borders/compound-border-frame-native.pdf'),('border-corner-controls',work/'native.pdf'),('border-corner-mixed-counts',work/'mixed-counts-native.pdf')]:
 labels=[];r=PdfReader(pdf);height=float(r.pages[0].mediabox.height)
 r.pages[0].extract_text(visitor_text=lambda text,cm,tm,font,size:labels.append(height-tm[5]) if text.startswith(('Table corner:','table:')) else None)
 page=pdfium.PdfDocument(pdf)[0]
 boxes=[]
 for o in page.get_objects():
  if o.type!=2:continue
  x0,y0,x1,y1=o.get_bounds();color=[ctypes.c_uint() for _ in range(4)]
  assert pdfium.raw.FPDFPageObj_GetFillColor(o.raw,*[ctypes.byref(v) for v in color])
  boxes.append([x0,height-y1,x1-x0,y1-y0,'#'+''.join(f'{v.value:02X}' for v in color[:3])])
 tables=[]
 for i,top in enumerate(labels):
  bs=[b for b in boxes if b[1]>=top and b[1]+b[3]<(labels[i+1] if i+1<len(labels) else height)]
  x=min(b[0] for b in bs);y=min(b[1] for b in bs)
  tables.append({'rectangles':[[round(a-x,5),round(b-y,5),round(c,5),round(d,5),color] for a,b,c,d,color in bs]})
 source=repo/'public/fixtures'/f'{name}.docx'
 cases.append({'fixture':name,'docxSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'tables':tables})
(repo/'tests/fixtures/border-corners/reference.json').write_text(json.dumps({'referenceVersion':'16.0.20326','cases':cases},indent=2)+'\n')
