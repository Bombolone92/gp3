"""Measure independently captured reference fill profiles without resizing pixels.

Run after opening exact owned controls through the reference-application helper and observing
them at 100% in Sky. The page origin (56,96) comes from the observed page edge,
not fitted artwork. JPEG profiles establish footprint, not exact color/alpha.
"""
from pathlib import Path
from hashlib import sha256
import json,math,statistics,sys
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/solid-fill-display'
WORK=Path(sys.argv[1])
digest=lambda p:sha256(p.read_bytes()).hexdigest()
rows=[]
benchmarks=json.loads((WORK/'solid-fill-benchmark-20261005.json').read_text())
for name in ['control','boundary','horizontal','group-horizontal','group-vertical','group-offset-horizontal','group-offset-vertical']:
    horizontal=name.endswith('horizontal')
    prefix='solid-fill' if name=='control' else 'solid-fill-group' if name=='group-horizontal' else 'solid-fill-'+name
    native=WORK/f'{prefix}-native-100-20261005.png'
    owned=WORK/('solid-fill-display-owned-20261005.docx' if name=='control' else prefix+'-owned-20261005.docx')
    source=FOLDER/f'{name}.docx'
    assert source.read_bytes()==owned.read_bytes(),'Native owned copy changed'
    manifest=json.loads((FOLDER/('cases.json' if name=='control' else name+'-cases.json')).read_text())
    assert digest(source)==manifest['sourceSha256']
    full=Image.open(native)
    assert full.format=='JPEG' and full.size==(946,536)
    full=full.convert('RGB')
    app=Image.open(WORK/f'{prefix}-candidate-20261005-page1.png').convert('RGB')
    profiles=[]
    for case in manifest['cases']:
        # Use the authored integer EMUs, including rounding at half an EMU.
        x=case['xEmu']/9525;y=case['yEmu']/9525
        start=math.floor(y if horizontal else x);fixed=round(x+12 if horizontal else y+12);offsets=list(range(-3,6));read=[]
        for image,ox,oy in [(full,56,96),(app,0,0)]:
            read.append([[statistics.median(image.getpixel((ox+fixed+dy,oy+start+d) if horizontal else (ox+start+d,oy+fixed+dy))[k] for dy in range(-5,6)) for k in range(3)] for d in offsets])
        native_ink=[start+d for d,color in zip(offsets,read[0]) if color[0]<190]
        app_ink=[start+d for d,color in zip(offsets,read[1]) if color[0]<190]
        assert native_ink==app_ink,(name,case['index'],native_ink,app_ink)
        assert all(color==[102,151,72] for d,color in zip(offsets,read[1]) if start+d in app_ink)
        profiles.append(dict(index=case['index'],axis='y' if horizontal else 'x',start=start,fixed=fixed,offsets=offsets,nativeRgb=read[0],appRgb=read[1],nativeInkCoordinates=native_ink))
    # Begin below the caret and any application tooltip overlapping the page edge.
    # All authored shape pixels are below y=168 in the observed native window.
    crop=FOLDER/f'native-{name}-100.png';full.crop((56,166,872,432)).save(crop)
    benchmark=next(row for row in benchmarks if row['file'].endswith('/'+name+'.docx'))
    print_hashes={p[v]['printSha256'] for p in benchmark['pairs'] for v in ['baseline','candidate']}
    assert len(print_hashes)==1,'Print projection changed'
    rows.append(dict(control=name,sourceSha256=digest(source),nativeCopyUnchanged=True,screenshotSha256=digest(native),
                     nativeCropSha256=digest(crop),pageOrigin=[56,96],cropPageOffset=[0,70],zoomPercent=100,profiles=profiles,
                     baselinePrintRevision='c6b7078e',baselinePrintRgbaSha256=print_hashes.pop()))
record=dict(method='Sky screenshot of exact already-open independent control; unscaled analytical crop excluding application chrome. Red<190 distinguishes opaque green fill from JPEG ringing, not an opacity correction.',observations=rows,
            scope='112 horizontal/vertical straight-edge cross-sections, including nonuniform and translated groups, at 100% native zoom, DPR1. Arbitrary zoom, color/alpha and screen/print matching are not established by this JPEG capture.')
(FOLDER/'reference.json').write_text(json.dumps(record,indent=2)+'\n')
print('PASS 112 native filled-rectangle profiles; candidate retains opaque source color')
