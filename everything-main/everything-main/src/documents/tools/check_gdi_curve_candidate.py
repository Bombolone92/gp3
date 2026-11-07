from pathlib import Path
import json, math
rows=json.loads((Path(__file__).resolve().parents[1]/'docs/evidence/gdi-curve-flattening-2026-09-27.json').read_text(encoding='utf-8-sig'))
result=[]
for row in rows:
 raw=row['original']; source=[tuple(math.ceil(v*16) for v in p) for p in zip(raw[::2],raw[1::2])]
 raw=row['points']; native=list(zip(raw[::2],raw[1::2]))
 # Enumerate deep subdivision endpoints to distinguish quantization from
 # the still-unknown adaptive stopping rule. This is NOT a renderer model.
 candidates=set()
 def split(p,depth):
  if not depth:
   candidates.add(tuple(math.floor(v+.5)/16 for v in p[3]));return
  def half(a,b):return tuple((x+y)/2 for x,y in zip(a,b))
  a,b,c=half(p[0],p[1]),half(p[1],p[2]),half(p[2],p[3]);d,e=half(a,b),half(b,c);f=half(d,e)
  split([p[0],a,d,f],depth-1);split([f,e,c,p[3]],depth-1)
 for i in range(0,12,3):split(source[i:i+4],10)
 missing=[p for p in native if p not in candidates]
 result.append(dict(bounds=row['bounds'],flatness=row['flatness'],points=len(native),unexplained=len(missing),examples=missing[:3]))
print(json.dumps(result,indent=2))
