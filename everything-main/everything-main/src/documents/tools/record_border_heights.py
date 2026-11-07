"""Independent exact-height observations: screen ink and private PDF geometry."""
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image
import hashlib, json, math, sys
import numpy as np

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/border-phase'
work=Path(sys.argv[1]);sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
q=lambda v:math.floor((v-1e-7)/.16)*.16
snap=lambda v:math.floor(v+.5+1e-7)
result=dict(engineRevision='d421e857',referenceBuild='16.0.20326',scope='Independent exact-row-height controls. Existing 600dpi hypothesis is frozen and tested without fitting these observations; no production rule or whole-page equivalence is claimed.',controls=[])
for name in ['heights-thin','heights-wide']:
    source=folder/f'{name}.docx';casesPath=folder/f'{name}-cases.json';cases=json.loads(casesPath.read_text())
    pdf=work/f'border-phase-{name}-native.pdf';reader=PdfReader(pdf)
    assert len(reader.pages)==1 and list(reader.pages[0].mediabox)==[0,0,288,216]
    groups=[];active=False;pending=None
    for args,op in ContentStream(reader.pages[0].get_contents(),reader).operations:
        if op==b'cm':raise AssertionError('Transforms require explicit geometry handling.')
        if op==b'BMC' and str(args[0])=='/Artifact':active=True;rectangles=[]
        elif active and op==b're':pending=[float(v) for v in args]
        elif active and op in [b'f',b'f*']:
            assert pending is not None;rectangles.append(pending);pending=None
        elif active and op==b'EMC':groups.append(rectangles);active=False
    assert len(groups)==16 and all(len(g)==12 for g in groups)
    baseline=work/f'border-phase-{name}-baseline';layout=json.loads((baseline/'results.json').read_text())
    assert [r['zoom'] for r in layout]==[1,2]
    assert all(r['pages']==1 and not r['readOnly'] and not r['errors'] and len(r['cells'])==16 for r in layout)
    logical={}
    for stroke in layout[0]['logical']:logical.setdefault(stroke['tableId'],[]).append(stroke)
    assert len(logical)==16
    physical=[]
    for c,rects,strokes in zip(cases,groups,logical.values()):
        bounds=[min(r[0] for r in rects),216-max(r[1]+r[3] for r in rects),max(r[0]+r[2] for r in rects),216-min(r[1] for r in rects)]
        app=[min(s['x'] for s in strokes)*.75,min(s['y'] for s in strokes)*.75,max(s['x']+s['width'] for s in strokes)*.75,max(s['y']+s['height'] for s in strokes)*.75]
        physical.append(dict(id=c['id'],boundsPt=bounds,baselineBoundsPt=app,rectangles=rects))
    observations=[];matching=[0,0,0,0];counterexamples=[]
    for zoom,origin,size in [(100,(439,310),(384,288)),(200,(247,212),(768,518))]:
        scale=zoom/100;capture=work/f'border-phase-{name}-native-{zoom}.jpg';image=Image.open(capture)
        assert image.format=='JPEG' and image.size==(1280,752)
        crop=image.crop((*origin,origin[0]+size[0],origin[1]+size[1]));path=folder/f'native-{name}-{zoom}.png';crop.save(path)
        native=np.array(crop.convert('RGB'));app=np.array(Image.open(baseline/f'app-{zoom}.png').convert('RGB'))
        regions=[];comparisons=[]
        for c in cases:
            x=int((c['xTwips']-c['phaseTwips'])/15*scale)-6
            y=int((c['yTwips']-c['phaseTwips'])/15*scale)-6
            w=int(c['widthTwips']/15*scale)+18;h=math.ceil(c['heightTwips']/15*scale)+18
            assert x>=0 and y>=0 and x+w<=size[0] and y+h<=size[1]
            def bounds(a):
                p=a[y:y+h,x:x+w];assert np.max(p.max(axis=2).astype(int)-p.min(axis=2))<=2
                yy,xx=np.where(p.max(axis=2)<128);assert len(xx)>0
                return [int(xx.min()+x),int(yy.min()+y),int(xx.max()+x+1),int(yy.max()+y+1)]
            n,b=bounds(native),bounds(app);regions.append([x,y,w,h])
            sx,sy=c['xTwips']/15,c['yTwips']/15;bw=c['size']/6;d=math.floor(bw*scale+1e-7)
            predicted=[snap(q(sx)*scale)+min(0,d-1),snap(q(sy)*scale),snap(q(sx+c['widthTwips']/15)*scale)+d,snap(q(sy+c['heightTwips']/15+bw)*scale)]
            for axis in range(4):matching[axis]+=int(predicted[axis]==n[axis])
            if predicted!=n:counterexamples.append(dict(zoom=zoom,id=c['id'],predicted=predicted,native=n))
            comparisons.append(dict(id=c['id'],native=n,baseline=b,equal=n==b))
        observations.append(dict(zoom=zoom,origin=origin,size=size,crop=path.name,cropSha256=sha(path),captureSha256=sha(capture),regions=regions,comparisons=comparisons))
    result['controls'].append(dict(source=source.name,cases=casesPath.name,sourceSha256=sha(source),casesSha256=sha(casesPath),pdfSha256=sha(pdf),threshold=128,physical=physical,observations=observations,frozen600DpiModel=dict(matchingEdges=matching,frames=32,counterexamples=counterexamples)))
    print(name,'baseline mismatches:',sum(not c['equal'] for o in observations for c in o['comparisons']),'of 32; frozen model edges:',matching,'of 32 each')
(folder/'native-height-reference.json').write_text(json.dumps(result,indent=2)+'\n')
