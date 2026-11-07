"""Bind independently exported reference baselines and font resources to source bytes."""
from pypdf import PdfReader
import pypdfium2 as pdf
import json,ctypes
from pathlib import Path
import hashlib
ROOT=Path(__file__).resolve().parents[1]/'tests/fixtures/line-separator-fonts'
r=PdfReader(ROOT/'native.pdf');d=pdf.PdfDocument(ROOT/'native.pdf');cases=json.loads((ROOT/'cases.json').read_text());rows=[]
for i,p in enumerate(d):
 t=p.get_textpage();ns=[]
 for s in ['Start','Sample','Tail']:
  j,n=t.search(s).get_next();x,y=ctypes.c_double(),ctypes.c_double();pdf.raw.FPDFText_GetCharOrigin(t,j,ctypes.byref(x),ctypes.byref(y));ns.append(p.get_height()-y.value)
 fonts=[f.get_object().get('/BaseFont') for f in r.pages[i]['/Resources']['/Font'].values()]
 rows.append(dict(case=cases[i][0],page=i+1,baselines=ns,fonts=fonts))

ref=dict(referenceVersion="16.0.20326",pages=len(d),sha256={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in ["control.docx","native.pdf","cases.json"]},rows=rows)
(ROOT/"reference.json").write_text(json.dumps(ref,indent=2)+"\n")
