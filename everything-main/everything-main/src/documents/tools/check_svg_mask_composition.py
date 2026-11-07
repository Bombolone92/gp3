"""Compare native identity-filter source pixels to native mask pixels."""
from pathlib import Path
from hashlib import sha256
import json, math, sys
from PIL import Image

root = Path(__file__).resolve().parents[1]/'tests/fixtures'
fixture = sys.argv[1] if len(sys.argv)>1 else 'svg-mask-composition'
assert fixture in ['svg-mask-composition','svg-mask-nested','svg-mask-opacity','svg-mask-opacity-expanded','svg-mask-opaque']
opaque = '--opaque-luminance' in sys.argv
folders = [root/(fixture+'-intermediate'),root/fixture]
refs = [json.loads((p/'metafile-reference.json').read_text()) for p in folders]
assert len(refs[0]['images']) == len(refs[1]['images']) == 6
for folder,ref in zip(folders,refs):
    assert sha256((folder/'native.emf').read_bytes()).hexdigest() == ref['nativeSha256']
    assert sha256((root.parent.parent/'public/fixtures'/(folder.name+'.docx')).read_bytes()).hexdigest() == ref['sourceSha256']
    for image in ref['images']:
        assert sha256((folder/image['path']).read_bytes()).hexdigest() == image['sha256']
rows = []
for i,(source,mask) in enumerate(zip(refs[0]['images'],refs[1]['images'])):
    for image in [source,mask]:
        assert image['transform'][:4] == [1,0,0,1]
        assert all(int(n)==n for n in image['transform'][4:])
    a,b = [Image.open(p/im['path']).convert('RGBA') for p,im in zip(folders,[source,mask])]
    dx = int(mask['transform'][4]-source['transform'][4])
    dy = int(mask['transform'][5]-source['transform'][5])
    differences = []
    for y in range(b.height):
        for x in range(b.width):
            pixel = a.getpixel((x+dx,y+dy)) if 0<=x+dx<a.width and 0<=y+dy<a.height else (0,0,0,0)
            luminance = math.floor(sum(v*w for v,w in zip(pixel,[.2126,.7152,.0722]))+.5)
            alpha = luminance if opaque else math.floor(luminance*pixel[3]/255+.5)
            native = b.getpixel((x,y))[3]
            if alpha!=native:
                differences.append(dict(x=x,y=y,sourcePixel=pixel,predicted=alpha,native=native))
    rows.append(dict(case=i, sourceSize=source['size'],maskSize=mask['size'],differentPixels=len(differences),maximumError=max((abs(d['predicted']-d['native']) for d in differences),default=0),examples=differences[:12]))
print(json.dumps(rows,indent=2))
raise SystemExit(int(any(r['differentPixels'] for r in rows)))
