"""Original diagnostic: test simple intermediate HSL quantization hypotheses.

Runs 4,802 candidates over all 768 native color controls. This deliberately
reports candidate matches, not a conformance pass. Never used by the renderer.
Redirect stdout to retain the JSON report. No third-party packages required.
"""
from pathlib import Path
import colorsys,json,math,itertools,time
root=Path(__file__).resolve().parents[1]/'tests/fixtures'
rows=[]
for name in ['theme-shade-sweep','theme-color-precision','theme-color-boundaries']:
 p=root/name;c=json.loads((p/'cases.json').read_text());saved=p/'native-saved-colors.json';ref=json.loads((saved if saved.exists() else p/'reference.json').read_text()); native=[list(bytes.fromhex(x['attributes']['val'])) for x in ref] if saved.exists() else [x['rgb'] for x in ref['colors']]
 rows.extend((colorsys.rgb_to_hls(*[v/255 for v in bytes.fromhex(x['base'])]),x['mode'],x['value']/255,n) for x,n in zip(c,native))
opts=[(0,'none')]+list(itertools.product([240,255,256],['floor','round']))
def quant(v,q):
 scale,mode=q
 return v if not scale else (math.floor(v*scale+(0.5 if mode=='round' else 1e-9)))/scale
best=[]
for hq,sq,lq,nq in itertools.product(opts,repeat=4):
 scores=[0,0];check=[]
 for (h,l,s),mode,v,native in rows:
  h,s,l=quant(h,hq),quant(s,sq),quant(l,lq)
  l=quant(l*v if mode=='shade' else l*v+1-v,nq)
  rgb=colorsys.hls_to_rgb(h,l,s)
  for i,bias in enumerate([1e-9,.5]):scores[i]+=all(math.floor(c*255+bias)==n for c,n in zip(rgb,native))
 for out,score in zip(['floor','round'],scores):best.append({'matches':score,'h':hq,'s':sq,'lightBefore':lq,'lightAfter':nq,'rgb':out})
best.sort(key=lambda x:-x['matches']);result={'cases':len(rows),'candidates':len(best),'best':best[:12]};print(json.dumps(result,indent=2))

