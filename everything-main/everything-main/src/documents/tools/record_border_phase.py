"""Bind independent reference screen and PDF geometry to the phase control."""
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image
import numpy as np
import hashlib, json, sys

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/border-phase'
work=Path(sys.argv[1]);cases=json.loads((folder/'cases.json').read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert (work/'border-phase-native.docx').read_bytes()==(folder/'control.docx').read_bytes()
pdf_path=work/'border-phase-native.pdf'
# Keep the native PDF private; publish only numeric border geometry and its hash.
reader=PdfReader(pdf_path);assert len(reader.pages)==1
assert list(reader.pages[0].mediabox)==[0,0,288,216]
groups=[];active=False;rectangles=[];pending=None
for args,op in ContentStream(reader.pages[0].get_contents(),reader).operations:
    if op==b'BMC' and str(args[0])=='/Artifact':active=True;rectangles=[]
    elif active and op==b're':pending=[float(x) for x in args]
    elif active and op in (b'f',b'f*'):
        assert pending is not None;rectangles.append(pending);pending=None
    elif active and op==b'EMC':groups.append(rectangles);active=False
assert len(groups)==16 and all(len(g)==12 for g in groups)
baseline=json.loads((work/'border-phase-baseline/results.json').read_text())[0]
logical_groups={}
for stroke in baseline['logical']:logical_groups.setdefault(stroke['tableId'],[]).append(stroke)
assert len(logical_groups)==16
physical=[]
for case,rects,strokes in zip(cases,groups,logical_groups.values()):
    left=min(r[0] for r in rects);right=max(r[0]+r[2] for r in rects)
    top=216-max(r[1]+r[3] for r in rects);bottom=216-min(r[1] for r in rects)
    b=[min(s['x'] for s in strokes)*.75,min(s['y'] for s in strokes)*.75,
       max(s['x']+s['width'] for s in strokes)*.75,max(s['y']+s['height'] for s in strokes)*.75]
    physical.append(dict(id=case['id'],boundsPt=[left,top,right,bottom],baselineBoundsPt=b,rectangles=rects))
observations=[]
for zoom,origin,size in [(100,(439,310),(384,288)),(200,(247,212),(768,518))]:
    scale=zoom/100;capture=work/f'border-phase-native-{zoom}.jpg';image=Image.open(capture)
    assert image.format=='JPEG' and image.size==(1280,752)
    crop=image.crop((*origin,origin[0]+size[0],origin[1]+size[1]));path=folder/f'native-{zoom}.png';crop.save(path)
    native=np.array(crop.convert('RGB'));app=np.array(Image.open(work/f'border-phase-baseline/app-{zoom}.png').convert('RGB'))
    regions=[];comparisons=[]
    for case in cases:
        x=int((case['xTwips']-case['phaseTwips'])/15*scale)-6
        y=int((case['yTwips']-case['phaseTwips'])/15*scale)-6
        w=int(64*scale)+18;h=int(32*scale)+18
        assert x>=0 and y>=0 and y+h<=size[1] and x+w<=size[0]
        def bounds(a):
            pixels=a[y:y+h,x:x+w];assert np.max(pixels.max(axis=2).astype(int)-pixels.min(axis=2))<=2
            yy,xx=np.where(pixels.max(axis=2)<128)
            assert len(xx)>0
            return [int(xx.min()+x),int(yy.min()+y),int(xx.max()+x+1),int(yy.max()+y+1)]
        n,b=bounds(native),bounds(app);regions.append([x,y,w,h])
        comparisons.append(dict(id=case['id'],native=n,baseline=b,equal=n==b))
    observations.append(dict(zoom=zoom,origin=origin,size=size,crop=path.name,cropSha256=sha(path),captureSha256=sha(capture),regions=regions,comparisons=comparisons))
ref=dict(sourceSha256=sha(folder/'control.docx'),casesSha256=sha(folder/'cases.json'),pdfSha256=sha(pdf_path),threshold=128,physical=physical,observations=observations)
(folder/'reference.json').write_text(json.dumps(ref,indent=2)+'\n')
print('Mismatching frame bounds:',sum(not c['equal'] for o in observations for c in o['comparisons']),'of 32.')
