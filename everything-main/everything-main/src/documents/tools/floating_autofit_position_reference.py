from pathlib import Path
import ctypes,json,hashlib
import pypdfium2 as P
out=Path(__file__).resolve().parents[1]/'tests/fixtures/floating-autofit-position'
doc=P.PdfDocument(out/'native.pdf');assert len(doc)==6
refs=[]
for i,page in enumerate(doc):
 t=page.get_textpage();s=t.get_text_range();lines=[]
 for label in ['Location: Assembly room','Date: September 22','Time: 2:00 PM']:
  k=s.index(label);x,y=ctypes.c_double(),ctypes.c_double();P.raw.FPDFText_GetCharOrigin(t,k,ctypes.byref(x),ctypes.byref(y));lines.append(dict(text=label,x=x.value,y=page.get_height()-y.value))
 refs.append(lines);page.render(scale=1).to_pil().save(out/f'native-page{i+1}.png')
(out/'origins.json').write_text(json.dumps(refs,indent=2))
(out/'manifest.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',sha256={n:hashlib.sha256((out/n).read_bytes()).hexdigest() for n in ['control.docx','native.pdf','origins.json']}),indent=2)+'\n')
