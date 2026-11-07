"""Compare a proposed conversion with independent native opacity controls."""
from pathlib import Path
import hashlib, json, math, struct
from PIL import Image
from native_shadow_images import native_images

root=Path(__file__).resolve().parents[1]/'tests/fixtures/shadow-color-quantization'
cases=json.loads((root/'cases.json').read_text())
rows=[]
for page,case in enumerate(cases,1):
    emf=root/f'shadow-color-{page}.emf'; png=root/f'shadow-color-{page}.png'
    native=native_images(emf)
    image=Image.open(png).convert('RGB')
    assert image.size==(4232,1269)
    point=(2433,633);rgb=image.getpixel(point)
    assert all(image.getpixel((point[0]+x,point[1]+y))==rgb for x in range(-10,11) for y in range(-10,11))
    alpha=struct.unpack('<f',struct.pack('<f',case['alpha']/100000))[0]
    colors=[int(case['color'][n:n+2],16) for n in (0,2,4)]
    hypothesis=[min(255,math.floor(math.floor(c*alpha+.5)/alpha)) for c in colors]+[math.floor(alpha*255+.5)]
    byte_alpha=math.floor(case['alpha']*255/100000+.5)
    fixed={str(bits):[(math.floor(c*byte_alpha/255+.5)*((255*(1<<bits))//byte_alpha))//(1<<bits)
                     for c in colors]+[byte_alpha] for bits in (8,12,16,24)}
    rows.append(dict(**case,page=page,nativeImages=native,gdiRgb=list(rgb),
        floatAlphaHypothesis=hypothesis,hypothesisMatches=hypothesis==native[0]['centerRgba'],fixedReciprocalHypotheses=fixed))
files=['source.docx','cases.json']+[f'shadow-color-{i}.{ext}' for i in range(1,len(cases)+1) for ext in ('emf','png')]
ref=dict(referenceVersion='16.0.20326',scope='Native EMF+ PNG center bytes and GDI+ playback; not native screen pixels. Formula is a diagnostic hypothesis.',
    hashes={f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in files},cases=rows)
(root/'reference.json').write_text(json.dumps(ref,indent=2)+'\n')
for r in rows:
    if not r['hypothesisMatches']:print(r['name'],r['nativeImages'][0]['centerRgba'],r['floatAlphaHypothesis'])
print(sum(r['hypothesisMatches'] for r in rows),'of',len(rows),'match proposed float-alpha conversion')
for bits in (8,12,16,24):
    print(bits,'bit reciprocal matches',sum(r['fixedReciprocalHypotheses'][str(bits)]==r['nativeImages'][0]['centerRgba'] for r in rows),'of',len(rows))
