from pathlib import Path
import pypdfium2 as P,ctypes,json,hashlib
out=Path(__file__).resolve().parents[1]/'tests/fixtures/symbol-cs-numbering';cases=json.loads((out/'cases.json').read_text());doc=P.PdfDocument(out/'native.pdf');assert len(doc)==1;page=doc[0];t=page.get_textpage();s=t.get_text_range();lines=[]
for case in cases:
 k=s.index(case['label']);x,y=ctypes.c_double(),ctypes.c_double();P.raw.FPDFText_GetCharOrigin(t,k,ctypes.byref(x),ctypes.byref(y));j=k-1
 while j>=0 and s[j].isspace():j-=1
 lines.append(dict(text=case['label'],x=x.value,y=page.get_height()-y.value,markerSize=P.raw.FPDFText_GetFontSize(t,j)))
page.render(scale=1.5).to_pil().save(out/'native.png');print(lines);assert all(abs(l['markerSize']-11)<0.1 for l in lines)
(out/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',cases=cases,lines={'control':lines},sha256={n:hashlib.sha256((out/n).read_bytes()).hexdigest() for n in ['control.docx','native.pdf']}),indent=2)+'\n')
