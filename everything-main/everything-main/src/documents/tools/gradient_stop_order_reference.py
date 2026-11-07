"""Evaluate the native reference PDF shading functions for gradient stop controls."""
from pathlib import Path
import json,hashlib
import pypdfium2 as pdf
from pypdf import PdfReader
from bisect import bisect_right
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/gradient-stop-order';cases=json.loads((folder/'cases.json').read_text(encoding='utf-8'));doc=pdf.PdfDocument(folder/'native.pdf');assert len(doc)==1
rows=[]
patterns=list(PdfReader(folder/'native.pdf').pages[0]['/Resources']['/Pattern'].values())
assert len(patterns)==len(cases)
def evaluate(function,t):
 f=function.get_object();domain=list(map(float,f.get('/Domain',[0,1])));t=max(domain[0],min(domain[1],t))
 if f['/FunctionType']==2:
  a=list(map(float,f.get('/C0',[0])));b=list(map(float,f.get('/C1',[1])));n=float(f['/N'])
  return [x+(y-x)*t**n for x,y in zip(a,b)]
 assert f['/FunctionType']==3
 bounds=list(map(float,f['/Bounds']));i=bisect_right(bounds,t);edges=[domain[0],*bounds,domain[1]];encode=list(map(float,f['/Encode']))
 assert edges[i+1]>edges[i]
 u=encode[2*i]+(t-edges[i])*(encode[2*i+1]-encode[2*i])/(edges[i+1]-edges[i])
 return evaluate(f['/Functions'][i],u)
for c,pattern in zip(cases,patterns):
 shading=pattern.get_object()['/Shading'];assert shading['/ShadingType']==2
 x0,y0,x1,y1=map(float,shading['/Coords']);assert y0==y1
 samples=[]
 for frac in [.02,.125,.25,.375,.49,.51,.625,.75,.875,.98]:
  x=c['x']+c['width']*frac;y=c['y']+c['height']*.5
  samples.append(dict(x=x,y=y,rgb=[round(v*255,6) for v in evaluate(shading['/Function'],(x-x0)/(x1-x0))]))
 rows.append(dict(name=c['name'],samples=samples))
assert all([s['rgb'] for s in rows[i]['samples']]==[s['rgb'] for s in rows[0]['samples']] for i in range(1,6))
assert [s['rgb'] for s in rows[6]['samples']]==[s['rgb'] for s in rows[7]['samples']]
assert [s['rgb'] for s in rows[7]['samples']]!=[s['rgb'] for s in rows[8]['samples']]
(folder/'reference.json').write_text(json.dumps(dict(sourceSha256=hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),cases=rows),indent=2)+'\n',encoding='utf-8')
print('PASS all six permutations equal; stable ties equal; reversed ties differ; 100 native samples')
