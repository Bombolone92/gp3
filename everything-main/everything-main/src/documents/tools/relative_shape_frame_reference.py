"""Measure original relative-frame controls exported by the installed reference application."""
from pathlib import Path
import hashlib,json
import numpy as np
import pypdfium2 as pdf
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parents[1]/'tests/fixtures/relative-shape-frames'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
cases=json.loads((ROOT/'cases.json').read_text());p=pdf.PdfDocument(ROOT/'controls-native.pdf');reader=PdfReader(ROOT/'controls-native.pdf')
assert len(p)==len(cases)==23
pages=[]
for i,case in enumerate(cases):
 image=p[i].render(scale=4/3).to_pil().convert('RGB');a=np.asarray(image).astype(int)
 y,x=np.where(np.max(np.abs(a-[0,160,96]),axis=2)<=2);assert len(x)
 bounds=[float(v)*.75 for v in [x.min(),y.min(),x.max()+1,y.max()+1]]
 runs=[]
 def visit(text,cm,tm,font,size):
  if text.strip()=='Control text':runs.append(dict(text=text.strip(),fontSize=size,x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4],y=float(reader.pages[i].mediabox.height)-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5])))
 reader.pages[i].extract_text(visitor_text=visit)
 text_bounds=None
 if case.get('text'):
  ty,tx=np.where(np.max(np.abs(a-[18,52,86]),axis=2)<=2);assert len(tx)
  text_bounds=[float(v)*.75 for v in [tx.min(),ty.min(),tx.max()+1,ty.max()+1]]
 pages.append(dict(**case,bounds=bounds,runs=runs,textBounds=text_bounds,rgb96Sha256=hashlib.sha256(image.tobytes()).hexdigest()))
(ROOT/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',sourceSha256=sha(ROOT/'controls.docx'),pdfSha256=sha(ROOT/'controls-native.pdf'),pages=pages),indent=2)+'\n')
print('Measured',len(pages),'native frames')
