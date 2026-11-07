"""Retain native reference geometry and verify text-outline miter invariance."""
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdf,json,hashlib,re
p=Path(__file__).resolve().parents[1]/'tests/fixtures/text-outline-miters';d=pdf.PdfDocument(p/'native.pdf');assert len(d)==1
page=PdfReader(p/'native.pdf').pages[0];content=page.get_contents().get_data().decode('latin1');assert not re.search(r'[-\d.]+\s+M\b',content)
assert all('/ML' not in v.get_object() for v in page['/Resources'].get('/ExtGState',{}).values())
paths=[];points=[];join=0
for args,op in page.get_contents().operations:
 if op==b'j':join=int(args[0])
 if op in [b'm',b'l',b'c']:points.append((op.decode(),list(map(float,args))))
 if op in [b'S',b's']:paths.append((join,points));points=[]
assert [j for j,_ in paths]==[0]*7+[2]
for i,(_,points) in enumerate(paths):
 assert len(points)==len(paths[0][1])
 for (op,vs),(first,ws) in zip(paths[0][1],points):
  assert op==first
  assert all(abs(v-w-(78*i if k%2 else 0))<.011 for k,(v,w) in enumerate(zip(vs,ws)))
d[0].render(scale=4/3).to_pil().save(p/'native.png')
(p/'reference.json').write_text(json.dumps({n:hashlib.sha256((p/n).read_bytes()).hexdigest() for n in ['control.docx','native.pdf','native.png']},indent=2)+'\n',encoding='utf-8')
print('Eight paths match within PDF 0.01pt rounding; seven use default miter 10, last uses bevel')
