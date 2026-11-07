from pypdf import PdfReader
from pathlib import Path
import json,hashlib
root=Path(__file__).resolve().parents[1]/'tests/fixtures/continuous-geometry'
result={}
for f in root.glob('*.pdf'):
 pages=[]
 for i,p in enumerate(PdfReader(f).pages):
  runs=[]
  def visit(text,ctm,matrix,font,size):
   if text.strip():runs.append(dict(text=text.strip(),x=round(matrix[4],3),baseline=round(float(p.mediabox.height)-matrix[5],3)))
  p.extract_text(visitor_text=visit)
  pages.append(dict(width=float(p.mediabox.width),height=float(p.mediabox.height),runs=runs))
 result[f.stem]=dict(pages=pages,sha256={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in [f.name,f.stem+'.docx']})
 print(f.name,[(i,p['width'],p['height'],p['runs'][:4],p['runs'][-4:]) for i,p in enumerate(pages)])
(root/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
