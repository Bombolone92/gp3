from pathlib import Path
from hashlib import sha256
import ctypes as c
import json
import pypdfium2 as p
root=Path(__file__).resolve().parents[1]/'tests/fixtures/run-background-height'
cases=json.loads((root/'cases.json').read_text())
results=[]
for index,page in enumerate(p.PdfDocument(root/'native.pdf')):
 paths=[]
 for obj in page.get_objects():
  if obj.type!=p.raw.FPDF_PAGEOBJ_PATH:continue
  rgba=[c.c_uint() for _ in range(4)]
  p.raw.FPDFPageObj_GetFillColor(obj,*[c.byref(v) for v in rgba])
  if [v.value for v in rgba]!=[255,255,0,255]:continue
  x,bottom,right,top=obj.get_bounds()
  paths.append(dict(x=x,y=page.get_height()-top,width=right-x,height=top-bottom))
 paths.sort(key=lambda r:r['y'])
 t=page.get_textpage();baselines=[]
 for i in range(t.count_chars()):
  code=p.raw.FPDFText_GetUnicode(t,i)
  if code not in [ord('A'),ord('א')]:continue
  x,y=c.c_double(),c.c_double()
  assert p.raw.FPDFText_GetCharOrigin(t,i,c.byref(x),c.byref(y))
  baselines.append(page.get_height()-y.value)
 baselines.sort()
 subset=cases[index*6:index*6+6]
 assert len(subset)==len(paths)==len(baselines),(index,len(paths),len(baselines))
 for case,rect,baseline in zip(subset,paths,baselines):
  results.append(dict(**case,page=index,rect=rect,baseline=baseline))
data=dict(referenceVersion='16.0.20326',cases=results)
for file,key in [('control.docx','sourceSha256'),('native.pdf','pdfSha256'),('cases.json','casesSha256')]:data[key]=sha256((root/file).read_bytes()).hexdigest()
(root/'reference.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
for r in results: print(r['index'],r['rtl'],r['kind'],r['rule'],r['value'],'mixed',r['mixed'],'above',round(r['baseline']-r['rect']['y'],3),'below',round(r['rect']['y']+r['rect']['height']-r['baseline'],3),'height',round(r['rect']['height'],3))
