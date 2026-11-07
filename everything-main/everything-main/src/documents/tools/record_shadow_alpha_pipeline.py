"""Test final-alpha channel conversion against native translucent/blurred shadows."""
from pathlib import Path
import hashlib,json,math
from native_shadow_images import native_images
root=Path(__file__).resolve().parents[1]/'tests/fixtures/shadow-alpha-pipeline'
cases=json.loads((root/'cases.json').read_text());rows=[]
for page,case in enumerate(cases,1):
    images=native_images(root/f'shadow-color-{page}.emf',histogram=True)
    assert images[1]['centerRgba']==[0,0,0,case['sourceAlpha']]
    colors=[int(case['color'][n:n+2],16) for n in (0,2,4)]
    errors=[];nonzero=0
    for pixel in images[0]['histogram']:
        *rgb,a=pixel['rgba']
        if not a:continue
        nonzero+=pixel['count']
        predicted=[(math.floor(c*a/255+.5)*((255*65536)//a))//65536 for c in colors]
        if predicted!=rgb:errors.append(dict(**pixel,predictedRgb=predicted))
    rows.append(dict(**case,page=page,images=images,nonzeroPixels=nonzero,mismatchPixels=sum(p['count'] for p in errors),mismatches=errors))
files=['source.docx','cases.json']+[f'shadow-color-{i}.{ext}' for i in range(1,len(cases)+1) for ext in ('emf','png')]
ref=dict(referenceVersion='16.0.20326',scope='Exact EMF+ shadow PNG pixels; final-alpha conversion is a tested hypothesis, not assumed.',
    hashes={f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in files},cases=rows)
(root/'reference.json').write_text(json.dumps(ref,indent=2)+'\n')
for r in rows:print(r['name'],'center',r['images'][0]['centerRgba'],'mismatches',r['mismatchPixels'],'/',r['nonzeroPixels'])
