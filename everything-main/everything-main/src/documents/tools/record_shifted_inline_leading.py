from pathlib import Path
from hashlib import sha256
import ctypes,json
import pypdfium2 as pdf
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/shifted-inline-leading'
document=pdf.PdfDocument(folder/'native.pdf');cases=json.loads((folder/'cases.json').read_text())
for index,case in enumerate(cases):
 page=document[index];text=page.get_textpage();content=text.get_text_range();case['text']=[]
 for label in ['Left','Right']:
  at=content.index(label);x,y=ctypes.c_double(),ctypes.c_double();pdf.raw.FPDFText_GetCharOrigin(text,at,ctypes.byref(x),ctypes.byref(y))
  case['text'].append(dict(text=label,x=x.value,y=page.get_height()-y.value))
 images=list(page.get_objects(filter=[pdf.raw.FPDF_PAGEOBJ_IMAGE]));assert len(images)==1
 l,b,r,t=images[0].get_bounds();case['image']=dict(x=l,y=page.get_height()-t,width=r-l,height=t-b)
 text.close();page.close()
document.close()
result=dict(referenceVersion='16.0.20326',sourceSha256=sha256((folder/'controls.docx').read_bytes()).hexdigest(),pdfSha256=sha256((folder/'native.pdf').read_bytes()).hexdigest(),cases=cases)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
