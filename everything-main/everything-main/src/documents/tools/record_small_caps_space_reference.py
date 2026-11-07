"""Retain raw native glyph evidence; synthesized PDF spaces are not paint sizes."""
from pathlib import Path
import ctypes, hashlib, json
import pypdfium2 as pdf

root=Path(__file__).resolve().parents[1]/'tests/fixtures/small-caps-spaces'
source=root/'control.docx';reference=root/'native.pdf'
document=pdf.PdfDocument(reference);pages=[]
for page in document:
 text=page.get_textpage();chars=[]
 for i in range(text.count_chars()):
  x,y=ctypes.c_double(),ctypes.c_double()
  pdf.raw.FPDFText_GetCharOrigin(text.raw,i,ctypes.byref(x),ctypes.byref(y))
  chars.append(dict(text=text.get_text_range(i,1),size=pdf.raw.FPDFText_GetFontSize(text.raw,i),x=x.value,y=page.get_height()-y.value))
 pages.append(chars);text.close();page.close()
document.close()
result=dict(referenceVersion='16.0.20326',sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(reference.read_bytes()).hexdigest(),pages=pages)
(root/'reference.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
