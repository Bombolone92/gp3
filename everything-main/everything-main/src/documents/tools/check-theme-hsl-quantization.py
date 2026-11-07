"""Rejected HSL precision candidate; native mismatches deliberately exit nonzero.
Original diagnostic only. Never used by the document engine.
"""
from pathlib import Path
import colorsys, hashlib, json, math
ROOT=Path(__file__).resolve().parents[1]
def candidate(base,mode,value):
    rgb=[v/255 for v in bytes.fromhex(base)]
    h,l,s=colorsys.rgb_to_hls(*rgb)
    h=math.floor(h*255+.5)/255
    s=math.floor(s*256+1e-9)/256
    amount=value/255
    l=l*amount if mode=='shade' else l*amount+1-amount
    return [math.floor(c*255+1e-9) for c in colorsys.hls_to_rgb(h,l,s)]
results=[]
for name in ['theme-shade-sweep','theme-color-precision','theme-color-boundaries']:
    root=ROOT/'tests/fixtures'/name
    cases=json.loads((root/'cases.json').read_text())
    saved=root/'native-saved-colors.json'
    reference=saved if saved.exists() else root/'reference.json'
    data=json.loads(reference.read_text())
    expected=[list(bytes.fromhex(x['attributes']['val'])) for x in data] if saved.exists() else [x['rgb'] for x in data['colors']]
    differences=[]
    for c,native in zip(cases,expected):
        actual=candidate(c['base'],c['mode'],c['value'])
        if actual!=native:differences.append(dict(case=c,expected=native,actual=actual))
    results.append(dict(fixture=name,total=len(cases),matched=len(cases)-len(differences),failures=len(differences),examples=differences[:5],sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [root/'cases.json',reference]}))
print(json.dumps(results,indent=2))
raise SystemExit(int(any(r['failures'] for r in results)))
