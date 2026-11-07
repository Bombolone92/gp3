"""Extract independent reference fill bounds and text baselines, with capture hashes."""
from pathlib import Path
from ctypes import c_uint,byref
from pypdf import PdfReader
import pypdfium2 as pdf
import json,hashlib
root=Path(__file__).resolve().parents[1]/'tests/fixtures/shading-spacing'
for source in root.glob('*.docx'):
 name=source.stem;file=root/(name+'-native.pdf');doc=pdf.PdfDocument(file);reader=PdfReader(file);pages=[]
 for i,page in enumerate(doc):
  bands=[]
  for obj in page.get_objects():
   r,g,b,a=c_uint(),c_uint(),c_uint(),c_uint()
   if pdf.raw.FPDFPageObj_GetFillColor(obj,byref(r),byref(g),byref(b),byref(a)) and (r.value,g.value,b.value) in [(0,170,187),(221,170,0)]:
    x,y,right,top=obj.get_bounds();bands.append(dict(color=f'{r.value:02X}{g.value:02X}{b.value:02X}',y=page.get_height()-top,height=top-y))
  baselines={}
  def visit(t,c,m,f,size):
   if t.strip() in ['Before','Shaded','Following','After']:baselines[t.strip()]=page.get_height()-(m[4]*c[1]+m[5]*c[3]+c[5])
  reader.pages[i].extract_text(visitor_text=visit);pages.append(dict(bands=sorted(bands,key=lambda b:b['y']),baselines=baselines))
 (root/(name+'-reference.json')).write_text(json.dumps(dict(referenceVersion='16.0.20326',sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(file.read_bytes()).hexdigest(),pages=pages),indent=2)+'\n',encoding='utf-8')
