"""Compare text, cell-fill and border colors in the original fixed-grid PDFs.

This is an independent PDF diagnostic, not an engine color conversion oracle.
The authored grid is three 120-point columns beginning at x=36 points.
"""
from pathlib import Path
import json,math
from pypdf import PdfReader
from pypdf.generic import ContentStream
root=Path(__file__).resolve().parents[1]/'tests/fixtures'
result=[]
for name in ['theme-shade-sweep','theme-color-precision','theme-color-boundaries','theme-color-complements','theme-minmax-neighbors','theme-standard-accents']:
 d=root/name;p=PdfReader(d/'native.pdf');refpath=d/'reference.json';ref=json.loads(refpath.read_text())['colors'] if refpath.exists() else json.loads((d/'native-colors.json').read_text());rows=[]
 for pi,page in enumerate(p.pages):
  rgb=[0,0,0];stack=[];path=[];fills=[];borders=[]
  for args,op in ContentStream(page.get_contents(),p).operations:
   if op==b'q':stack.append(rgb[:])
   elif op==b'Q':rgb=stack.pop()
   elif op==b'rg':rgb=[math.floor(float(v)*255+.5) for v in args]
   elif op==b'g':rgb=[math.floor(float(args[0])*255+.5)]*3
   elif op==b're':path.append(list(map(float,args)))
   elif op in [b'f',b'f*']:
    for x,y,w,h in path:
     if abs(x-156.02)<.1 and abs(w-120.02)<.1 and h>10:fills.append((y,rgb[:]))
     if abs(x-276.05)<.1 and abs(w-120.02)<.1 and 0<h<3:borders.append((y,rgb[:]))
    path=[]
   elif op in [b'n',b'S',b's',b'B',b'B*']:path=[]
   elif op in [b'cm',b'k',b'cs',b'scn',b'Do']:raise RuntimeError(f'unsupported PDF op {op}')
  native=[r for r in ref if r['page']==pi];fills.sort(reverse=True);borders.sort(reverse=True)
  assert len(native)==len(fills)==len(borders),(name,pi,len(native),len(fills),len(borders))
  rows.extend({'label':r['label'],'text':r['rgb'],'fill':f[1],'border':b[1]} for r,f,b in zip(native,fills,borders))
 assert len(rows)==len(json.loads((d/'cases.json').read_text()))
 differences=[r for r in rows if r['text']!=r['fill'] or r['text']!=r['border']];result.append({'fixture':name,'cases':len(rows),'differences':len(differences),'examples':differences[:10]})
print(json.dumps(result,indent=2))
raise SystemExit(int(any(r['differences'] for r in result)))
