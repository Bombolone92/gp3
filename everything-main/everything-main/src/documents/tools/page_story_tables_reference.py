"""Extract reference line origins, respecting PDF line delimiters between cells."""
from pathlib import Path
import ctypes,json,hashlib
import pypdfium2 as p
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/page-story-tables';pages=[]
for page in p.PdfDocument(folder/'native.pdf'):
 t=page.get_textpage();lines=[];boundary=True
 for i in range(t.count_chars()):
  c=t.get_text_range(i,1)
  if c in '\r\n':boundary=True;continue
  x,y=ctypes.c_double(),ctypes.c_double();p.raw.FPDFText_GetCharOrigin(t,i,ctypes.byref(x),ctypes.byref(y));baseline=page.get_height()-y.value
  if boundary or abs(lines[-1]['baseline']-baseline)>.5:lines.append(dict(text='',x=x.value,baseline=baseline))
  lines[-1]['text']+=c;boundary=False
 pages.append([{**l,'text':l['text'].strip()} for l in lines if l['text'].strip()])
result=dict(sourceSha256=hashlib.sha256((root/'public/fixtures/page-story-tables.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),pages=pages)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(pages,indent=2))
