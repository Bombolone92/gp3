"""Record independent reference text positions and red glyph bounds, without engine input."""
from pathlib import Path
import pypdfium2 as pdf
import numpy as np
import ctypes,json,hashlib
root=Path(__file__).resolve().parents[1]/'tests/fixtures/large-fonts'
hash=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
doc=pdf.PdfDocument(root/'native-verified.pdf');pages=[]
for p in doc:
 t=p.get_textpage();lines=[]
 for i in range(t.count_chars()):
  c=t.get_text_range(i,1)
  if not c.strip():continue
  x,y=ctypes.c_double(),ctypes.c_double();pdf.raw.FPDFText_GetCharOrigin(t,i,ctypes.byref(x),ctypes.byref(y));y=p.get_height()-y.value
  if not lines or abs(lines[-1]['y']-y)>.15:lines.append(dict(text='',x=x.value,y=y))
  lines[-1]['text']+=c
 im=np.array(p.render(scale=2).to_pil().convert('RGB')).astype('int16');mask=(im[:,:,0]-im[:,:,1]>40)&(im[:,:,0]-im[:,:,2]>30);y,x=np.where(mask)
 bounds=[float(x.min()/2),float(y.min()/2),float((x.max()+1)/2),float((y.max()+1)/2)] if len(x) else None
 pages.append(dict(lines=lines,ink=bounds))
(root/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',sourceSha256=hash(root/'control.docx'),pdfSha256=hash(root/'native-verified.pdf'),pages=pages),indent=2)+'\n')
