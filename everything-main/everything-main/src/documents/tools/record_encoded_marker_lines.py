"""Record native reference baselines for original encoded-marker controls."""
from pathlib import Path
import pypdfium2 as P,json,ctypes as C,hashlib
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/encoded-marker-lines';records=[]
for pi,p in enumerate(P.PdfDocument(folder/'native.pdf')):
 t=p.get_textpage();lines={}
 for i in range(t.count_chars()):
  char=t.get_text_range(i,1);x,y=C.c_double(),C.c_double();P.raw.FPDFText_GetCharOrigin(t,i,C.byref(x),C.byref(y));key=round(p.get_height()-y.value,2)
  if char not in '\r\n':lines[key]=lines.get(key,'')+char
 for y,text in lines.items():
  at=text.find('C'+str(pi).zfill(2))
  if at>=0:records.append(dict(page=pi,text=text[at:].strip(),y=y))
assert len(records)==4*len(json.loads((folder/'cases.json').read_text()))
(folder/'positions.json').write_text(json.dumps(records,indent=2)+'\n')
(folder/'hashes.json').write_text(json.dumps({n:hashlib.sha256((folder/n).read_bytes()).hexdigest() for n in ['encoded-marker-lines.docx','native.pdf']},indent=2)+'\n')
