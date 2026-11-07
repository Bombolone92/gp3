from pathlib import Path
import pypdfium2 as P,ctypes,json,hashlib
out=Path(__file__).resolve().parents[1]/'tests/fixtures/list-suffix-boundary';cases=json.loads((out/'cases.json').read_text());refs={}
for name in ['control','nohang']:
 doc=P.PdfDocument(out/(name+'.pdf'));assert len(doc)==1;page=doc[0];t=page.get_textpage();s=t.get_text_range();lines=[]
 for c in cases:
  k=s.index(c['label']);x,y=ctypes.c_double(),ctypes.c_double();P.raw.FPDFText_GetCharOrigin(t,k,ctypes.byref(x),ctypes.byref(y));lines.append(dict(text=c['label'],x=x.value,y=page.get_height()-y.value))
 refs[name]=lines;page.render(scale=1).to_pil().save(out/(name+'.png'))
(out/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',cases=cases,lines=refs,sha256={n:hashlib.sha256((out/n).read_bytes()).hexdigest() for n in ['control.docx','control.pdf','nohang.docx','nohang.pdf']}),indent=2)+'\n')
