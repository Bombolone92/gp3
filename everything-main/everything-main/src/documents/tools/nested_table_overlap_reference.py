"""Extract native text origins and cropped previews for original nested collision controls."""
from pathlib import Path
import ctypes,hashlib,json
import pypdfium2 as P
out=Path(__file__).resolve().parents[1]/'tests/fixtures/nested-table-overlap';cases=json.loads((out/'cases.json').read_text());doc=P.PdfDocument(out/'native.pdf');pages=[]
for case,page in zip(cases,doc):
 t=page.get_textpage();s=t.get_text_range();labels=['Case '+str(case['case']),'Before','After outer']
 for j in range(len(case['widths'])):
  labels += [chr(65+j)+str(case['case']),'Anchor '+str(j+1)]
  labels += [f'Line {j+1}.{k+1}' for k in range(case.get('heights',[15]*len(case['widths']))[j]//15-1)]
 lines=[]
 for label in labels:
  i=s.index(label);x,y=ctypes.c_double(),ctypes.c_double();P.raw.FPDFText_GetCharOrigin(t,i,ctypes.byref(x),ctypes.byref(y));lines.append(dict(text=label,x=x.value,y=page.get_height()-y.value))
 pages.append(lines);page.render(scale=1).to_pil().crop((70,65,550,290)).save(out/f"native-crop{case['case']}.png")
assert len(pages)==len(cases)
(out/'reference.json').write_text(json.dumps(dict(cases=cases,pages=pages,referenceVersion='16.0.20326',sha256={n:hashlib.sha256((out/n).read_bytes()).hexdigest() for n in ['control.docx','native.pdf']}),indent=2)+'\n')
