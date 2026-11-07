"""Retain independent reference border observations at intermediate zooms."""
from pathlib import Path
from PIL import Image
import numpy as np
import hashlib, json, math, sys

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/border-phase'
work=Path(sys.argv[1]); sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
cases=json.loads((folder/'cases.json').read_text())
original=json.loads((folder/'reference.json').read_text())
assert (work/'border-phase-native.docx').read_bytes()==(folder/'control.docx').read_bytes()
baseline=work/'border-phase-intermediate-baseline'
results=json.loads((baseline/'results.json').read_text())
assert [r['zoom'] for r in results]==[1,1.25,1.5,2]
assert all(r['pages']==1 and not r['readOnly'] and not r['errors'] for r in results)
assert all((baseline/f'app-{z}.png').read_bytes()==(work/f'border-phase-baseline/app-{z}.png').read_bytes() for z in [100,200])
observations=[]
for zoom,origin,size in [(125,(391,274),(480,360)),(150,(343,238),(576,432))]:
    capture=work/f'border-phase-native-{zoom}.jpg';image=Image.open(capture)
    assert image.format=='JPEG' and image.size==(1280,752)
    crop=image.crop((*origin,origin[0]+size[0],origin[1]+size[1]))
    path=folder/f'native-{zoom}.png';crop.save(path)
    native=np.array(crop.convert('RGB'));app=np.array(Image.open(baseline/f'app-{zoom}.png').convert('RGB'))
    comparisons=[];regions=[]
    for case in cases:
        s=zoom/100
        x=int((case['xTwips']-case['phaseTwips'])/15*s)-6
        y=int((case['yTwips']-case['phaseTwips'])/15*s)-6
        w=int(64*s)+18;h=int(32*s)+18
        assert x>=0 and y>=0 and x+w<=size[0] and y+h<=size[1]
        def bounds(a):
            pixels=a[y:y+h,x:x+w]
            assert np.max(pixels.max(axis=2).astype(int)-pixels.min(axis=2))<=2
            yy,xx=np.where(pixels.max(axis=2)<128);assert len(xx)>0
            return [int(xx.min()+x),int(yy.min()+y),int(xx.max()+x+1),int(yy.max()+y+1)]
        n,b=bounds(native),bounds(app)
        comparisons.append(dict(id=case['id'],native=n,baseline=b,equal=n==b));regions.append([x,y,w,h])
    observations.append(dict(zoom=zoom,origin=origin,size=size,crop=path.name,cropSha256=sha(path),captureSha256=sha(capture),regions=regions,comparisons=comparisons))
# These are diagnostic counterexamples, not a proposed reference placement algorithm.
models=[]
for mode in ['floor','round','ceil']:
    bad=[]
    for o in sorted(original['observations']+observations,key=lambda o:o['zoom']):
        s=o['zoom']/100
        for case,c in zip(cases,o['comparisons']):
            width=case['size']/6*s;paint=max(1,math.floor(width+1e-6))
            for axis in [0,1]:
                p=case['xTwips' if axis==0 else 'yTwips']/15*s
                predicted={'floor':math.floor,'round':lambda x:math.floor(x+.5),'ceil':math.ceil}[mode](p+width/2-paint/2+1e-6)
                if predicted!=c['native'][axis]:bad.append(dict(zoom=o['zoom'],id=case['id'],axis=axis,predicted=predicted,native=c['native'][axis]))
    models.append(dict(rounding=mode,checkedLeadingEdges=128,counterexamples=bad))
ref=dict(sourceSha256=sha(folder/'control.docx'),casesSha256=sha(folder/'cases.json'),originalReferenceSha256=sha(folder/'reference.json'),engineRevision='2ab603cf',threshold=128,observations=observations,rejectedCenterModels=models,limitations='Page origins vary with zoom; independent origin changes at the same zoom are not tested. JPEG threshold frame bounds are not exact colors, physical geometry, or whole-page equivalence.')
(folder/'native-intermediate-reference.json').write_text(json.dumps(ref,indent=2)+'\n')
print('Mismatching frames:',sum(not c['equal'] for o in observations for c in o['comparisons']),'of 32.')
