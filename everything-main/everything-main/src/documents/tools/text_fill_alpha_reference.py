"""Record native reference alpha graphics states and raster colors for paired controls."""
from pathlib import Path
from collections import Counter
import hashlib,json
import pypdfium2 as pdf
from pypdf import PdfReader
root=Path(__file__).resolve().parents[1]/'tests/fixtures/text-fill-alpha'
cases=json.loads((root/'cases.json').read_text());doc=pdf.PdfDocument(root/'native.pdf');raw=PdfReader(root/'native.pdf');assert len(doc)==len(cases)==12
rows=[]
for pi,page in enumerate(doc):
 image=page.render(scale=4).to_pil().convert('RGB');regions=[]
 for name,box in [('body',(90,95,310,130)),('shape',(96,150,340,183))]:
  crop=image.crop(tuple(round(v*4) for v in box))
  regions.append(dict(name=name,boxPt=box,colors=[dict(rgb=list(rgb),pixels=n) for rgb,n in Counter(crop.getdata()).most_common(4)]))
 states=raw.pages[pi]['/Resources'].get('/ExtGState',{})
 alphas=sorted(set(float(v.get_object()['/ca']) for v in states.values() if '/ca' in v.get_object()))
 rows.append(dict(case=cases[pi],pdfFillAlphas=alphas,regions=regions))
 print(pi+1,alphas,[(r['name'],r['colors'][:2]) for r in regions])
 page.close()
doc.close()
result=dict(referenceBuild='16.0.20326',pages=rows,hashes={n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ['control.docx','cases.json','native.pdf']})
(root/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
