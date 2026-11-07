"""Record native PDF baselines and bind them to the original source bytes."""
from pathlib import Path
import ctypes, hashlib, json
import pypdfium2 as pdf
root=Path(__file__).resolve().parents[1]/'tests/fixtures/floating-table-spacing'
pages=[]
for page in pdf.PdfDocument(root/'native.pdf'):
 text=page.get_textpage(); lines={}
 for i in range(text.count_chars()):
  char=text.get_text_range(i,1)
  if not char.strip():continue
  x,y=ctypes.c_double(),ctypes.c_double()
  pdf.raw.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y))
  at=page.get_height()-y.value; key=round(at,2)
  line=lines.setdefault(key,dict(text='',x=x.value,y=at));line['text']+=char
 pages.append(list(lines.values()))
result=dict(pages=pages,sha256={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ['control.docx','native.pdf','cases.json']})
(root/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
print(len(pages),'pages;',sum(map(len,pages)),'baselines')
