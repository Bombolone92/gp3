"""Record reference line boundaries and glyph origins for the unresolved wrap control."""
from pathlib import Path
import ctypes,json,hashlib
import pypdfium2 as pdf
p=Path(__file__).resolve().parents[1]/'tests/fixtures/font-size-wrap-boundary'
doc=pdf.PdfDocument(p/'native.pdf');rows=[]
for page_index,page in enumerate(doc):
 text=page.get_textpage();current=None
 for i in range(text.count_chars()):
  if text.get_text_range(i,1)!='M':continue
  x,y=ctypes.c_double(),ctypes.c_double();pdf.raw.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y))
  baseline=page.get_height()-y.value
  if current is None or abs(current['baseline']-baseline)>.1:
   current=dict(page=page_index,baseline=baseline,fontSize=pdf.raw.FPDFText_GetFontSize(text,i),origins=[]);rows.append(current)
  current['origins'].append(x.value)
cases=json.loads((p/'cases.json').read_text());reference=[];at=0
for case in cases:
 lines=[];count=0
 while count<32:
  row=rows[at];at+=1;lines.append(row);count+=len(row['origins'])
 assert count==32
 reference.append(dict(**case,lines=lines))
assert at==len(rows) and len(doc)==2
assert [len(r['lines']) for r in reference]==[1,1,1,1,2,1,1,1,1,1,2,1,1,1,1,1]
(p/'reference.json').write_text(json.dumps(dict(pages=len(doc),cases=reference,hashes={n:hashlib.sha256((p/n).read_bytes()).hexdigest() for n in ['control.docx','native.pdf']}),indent=2)+'\n',encoding='utf-8')
print('Native reference: 18 lines, two pages; 11pt and 17pt edge cases wrap')
