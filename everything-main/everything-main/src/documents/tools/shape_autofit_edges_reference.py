"""Extract native fill bounds and surrounding body baselines for edge controls."""
from pathlib import Path
from ctypes import c_uint,c_int,byref
import hashlib,json
import pypdfium2 as pdf
from pypdf import PdfReader
root=Path(__file__).resolve().parents[1]/'tests/fixtures/shape-autofit-edges'
sha=lambda b:hashlib.sha256(b).hexdigest()
refs={}
for name in ['noAutofit','spAutoFit']:
 source=root/(name+'.docx');native=root/(name+'-native.pdf');doc=pdf.PdfDocument(native);reader=PdfReader(native);pages=[]
 for i,page in enumerate(doc):
  boxes=[];baselines={}
  for obj in page.get_objects():
   r,g,b,a=c_uint(),c_uint(),c_uint(),c_uint();fill,stroke=c_int(),c_int()
   if pdf.raw.FPDFPath_GetDrawMode(obj,byref(fill),byref(stroke)) and fill.value and pdf.raw.FPDFPageObj_GetFillColor(obj,byref(r),byref(g),byref(b),byref(a)) and (r.value,g.value,b.value) in [(221,238,255),(17,170,187)]:
    x,y,right,top=obj.get_bounds();boxes.append(dict(color=f'{r.value:02X}{g.value:02X}{b.value:02X}',x=x,y=page.get_height()-top,width=right-x,height=top-y))
  def visit(t,c,m,f,s):
   if t.strip() in ['Before','After']:baselines[t.strip()]=page.get_height()-(m[4]*c[1]+m[5]*c[3]+c[5])
  reader.pages[i].extract_text(visitor_text=visit);pages.append(dict(boxes=boxes,baselines=baselines))
 refs[name]=dict(sourceSha256=sha(source.read_bytes()),pdfSha256=sha(native.read_bytes()),pages=pages)
(root/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',variants=refs),indent=2)+'\n')
print('Extracted 12 native edge-control pages')
