"""Record independently exported reference outline colors, not renderer expectations."""
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdf
import json,hashlib
p=Path(__file__).resolve().parents[1]/'tests/fixtures/text-outline-luminance'
r=PdfReader(p/'native.pdf');assert len(r.pages)==1
color=None;stack=[];colors=[]
for args,op in r.pages[0].get_contents().operations:
 if op==b'q':stack.append(color)
 if op==b'Q':color=stack.pop()
 if op==b'RG':color=list(map(float,args))
 if op==b'G':color=[float(args[0])]*3
 if op in [b'S',b's']:
  assert color is not None
  colors.append([round(v*255) for v in color])
assert len(colors)==len(json.loads((p/'cases.json').read_text()))
pdf.PdfDocument(p/'native.pdf')[0].render(scale=4/3).to_pil().save(p/'native.png')
(p/'reference.json').write_text(json.dumps(dict(colors=colors,hashes={n:hashlib.sha256((p/n).read_bytes()).hexdigest() for n in ['control.docx','native.pdf','native.png']}),indent=2)+'\n',encoding='utf-8')
