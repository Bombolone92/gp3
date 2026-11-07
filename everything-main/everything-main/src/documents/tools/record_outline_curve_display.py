"""Record independently captured reference curves without inferring an opacity rule."""
from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
from shutil import copyfile
import json, sys, math
import numpy as np
from PIL import Image, JpegImagePlugin
from pypdf import PdfReader
from pypdf.generic import ContentStream

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/outline-curve-display'
WORK=Path(sys.argv[1])
digest=lambda p:sha256(p.read_bytes()).hexdigest()
sources={}
for name,native in [('control','outline-curve-display-control.docx'),('phase-boundaries','outline-curve-phase-boundaries.docx')]:
    with ZipFile(OUT/(name+'.docx')) as a, ZipFile(WORK/native) as b:
        assert set(a.namelist())==set(b.namelist())
        assert all(a.read(n)==b.read(n) for n in a.namelist())
        sources[name]=dict(fixtureSha256=digest(OUT/(name+'.docx')),nativeSourceSha256=digest(WORK/native),partsSha256={n:sha256(a.read(n)).hexdigest() for n in a.namelist()})
observations=[]
for name,zoom,file,origin,visible in [
    ('control',100,'outline-curve-native-100.png',(272,202),(384,288)),
    ('control',200,'outline-curve-native-200.jpg',(247,212),(768,517)),
    ('phase-boundaries',100,'outline-boundary-native-100.jpg',(439,310),(384,288)),
    ('phase-boundaries',200,'outline-boundary-native-200.jpg',(247,212),(768,517))]:
    raw=Image.open(WORK/file); assert raw.format=='JPEG'
    full=np.array(raw.convert('RGB')); ox,oy=origin; scale=zoom/100
    manifest=json.loads((OUT/('cases.json' if name=='control' else 'phase-boundaries-cases.json')).read_text())
    measurements=[]
    for case in manifest:
        # Include surrounding pixels, but stay above the status bar in 200% captures.
        x=math.floor(case['xEmu']/9525*scale);y=math.floor(case['yEmu']/9525*scale)
        region=full[oy+y-3:oy+y+round(40*scale)+4,ox+x-3:ox+x+round(64*scale)+4]
        assert region.shape[:2]==(round(40*scale)+7,round(64*scale)+7)
        assert np.all(region[:,:,0]==region[:,:,1]) and np.all(region[:,:,1]==region[:,:,2]), (name,zoom,case['id'],'colored overlay')
        yy,xx=np.where(region[:,:,0]<240)
        measurements.append(dict(id=case['id'],boundsThreshold240=[int(xx.min()+x-3),int(yy.min()+y-3),int(xx.max()+x-3),int(yy.max()+y-3)]))
    crop=OUT/f'native-{name}-{zoom}.png'
    raw.crop((ox,oy,ox+visible[0],oy+visible[1])).save(crop,format='PNG')
    observations.append(dict(fixture=name,zoom=zoom,origin=origin,visiblePagePixels=visible,
        originalFormat=raw.format,originalSize=raw.size,originalSha256=digest(WORK/file),
        jpegSubsampling=JpegImagePlugin.get_sampling(raw),jpegQuantization=raw.quantization,
        crop=crop.name,cropSha256=digest(crop),measurements=measurements))
pdf=WORK/'outline-curve-phase-boundaries.pdf'; reader=PdfReader(pdf);assert len(reader.pages)==1
paths=[];points=[];pen=None
for args,op in ContentStream(reader.pages[0].get_contents(),reader).operations:
    assert op != b'cm', 'Transformed PDF paths require a transform-aware recorder'
    if op==b'w':pen=float(args[0])
    elif op==b'm':points=[list(map(float,args))]
    elif op in [b'l',b'c']:
        points.extend([list(map(float,args[i:i+2])) for i in range(0,len(args),2)])
    elif op==b'S':
        paths.append(dict(id=len(paths)+1,penPt=pen,leftPt=min(p[0] for p in points),
            frameTopPt=float(reader.pages[0].mediabox.height)-max(p[1] for p in points)))
assert len(paths)==16
cases=json.loads((OUT/'phase-boundaries-cases.json').read_text())
for case,path in zip(cases,paths):
    assert abs(path['leftPt']-math.trunc(case['xEmu']/635)/20)<0.00001
    assert abs(path['frameTopPt']-math.trunc(case['yEmu']/635)/20)<0.00001
copyfile(pdf,OUT/'native-phase-boundaries.pdf')
(OUT/'reference.json').write_text(json.dumps(dict(date='2026-09-30',baseline='9aaa0bbd',sources=sources,observations=observations,
    pdfSha256=digest(pdf),pdfPaths=paths,scope='Positive page-relative offsets, opaque gray curves, 100/200% native screen observations. Captures are JPEG; crops retain compression artifacts. PDF confirms whole-twip truncation of these authored offsets; no general opacity or other-coordinate rule is asserted.'),indent=2)+'\n',encoding='utf8')
print('Recorded 64 screen shape observations and 16 independent PDF path positions.')
