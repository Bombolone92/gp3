from pathlib import Path
import pypdfium2 as pdf
import ctypes,json,hashlib
root=Path(__file__).resolve().parents[1]/'tests/fixtures/discretionary-hyphen-metrics'
hash=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for mode in [15]:
 doc=pdf.PdfDocument(root/'native.pdf');pages=[]
 for pi,p in enumerate(doc):
  t=p.get_textpage();lines=[]
  for i in range(t.count_chars()):
   char=t.get_text_range(i,1)
   if not char.strip():continue
   x,y=ctypes.c_double(),ctypes.c_double();pdf.raw.FPDFText_GetCharOrigin(t,i,ctypes.byref(x),ctypes.byref(y));y=p.get_height()-y.value
   if not lines or abs(lines[-1]['y']-y)>.15:lines.append(dict(text='',x=x.value,y=y))
   lines[-1]['text']+=char
  pages.append(lines)
 (root/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',sourceSha256=hash(root/'control.docx'),pdfSha256=hash(root/'native.pdf'),pages=pages),indent=2)+'\n')
