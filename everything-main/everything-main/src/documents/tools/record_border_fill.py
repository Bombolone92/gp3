"""Separate cell shading placement from black border ink in paired controls."""
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image
import numpy as np
import hashlib, json, math, sys
from zipfile import ZipFile

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/border-phase'
work=Path(sys.argv[1]);sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
original=json.loads((folder/'reference.json').read_text())
screen=json.loads((folder/'native-intermediate-reference.json').read_text())
result=dict(scope='Numeric native PDF rectangles and threshold screen bounds of independently authored paired controls; not full visual equivalence or a production rounding rule.',engineRevision='15b6caeb',referenceBuild='16.0.20326',controls=[])
with ZipFile(folder/'control.docx') as z:originalParts={n:z.read(n) for n in z.namelist()}
for name in ['filled','borderless']:
    source=folder/f'{name}.docx';cases=folder/f'{name}-cases.json'
    with ZipFile(source) as z:parts={n:z.read(n) for n in z.namelist()}
    assert parts.keys()==originalParts.keys()
    assert all(parts[n]==originalParts[n] for n in parts if n!='word/document.xml')
    if name=='filled':assert parts['word/document.xml'].replace(b'<w:shd w:val="clear" w:color="auto" w:fill="FF0000"/>',b'')==originalParts['word/document.xml']
    pdf=work/f'border-phase-{name}-native.pdf';reader=PdfReader(pdf)
    assert len(reader.pages)==1 and list(reader.pages[0].mediabox)==[0,0,288,216]
    color=(0,0,0);stack=[];pending=None;red=[];black=[];group=None
    for args,op in ContentStream(reader.pages[0].get_contents(),reader).operations:
        if op==b'cm':raise AssertionError('Transforms need explicit geometry handling.')
        if op==b'q':stack.append(color)
        elif op==b'Q':color=stack.pop()
        elif op==b'rg':color=tuple(float(v) for v in args)
        elif op==b'g':color=tuple([float(args[0])]*3)
        elif op==b'BMC' and str(args[0])=='/Artifact':group=[]
        elif op==b're':pending=[float(v) for v in args]
        elif op in [b'f',b'f*']:
            assert pending is not None
            # Full-cell fill is at least half the authored 48x24pt cell.
            # Paragraph strips and coloured border-corner patches are excluded.
            if color==(1,0,0) and pending[2]>=24 and pending[3]>=12:red.append(pending)
            if group is not None and color==(0,0,0):group.append(pending)
            pending=None
        elif op==b'n':pending=None
        elif op==b'EMC' and group is not None:
            if group:black.append(group)
            group=None
    assert not stack and len(red)==16
    if name=='filled':assert black==[c['rectangles'] for c in original['physical']]
    else:assert not black
    baseline=work/f'border-phase-{name}-baseline';layout=json.loads((baseline/'results.json').read_text())
    assert [r['zoom'] for r in layout]==[1,1.25,1.5,2]
    assert all(r['pages']==1 and not r['readOnly'] and not r['errors'] and len(r['cells'])==16 for r in layout)
    observations=[]
    for zoom,origin,size in [(100,(439,310),(384,288)),(150,(343,238),(576,432))]:
        currentRegions=next(o['regions'] for o in (original['observations']+screen['observations']) if o['zoom']==zoom)
        capture=work/f'border-phase-{name}-native-{zoom}.jpg';image=Image.open(capture)
        assert image.format=='JPEG' and image.size==(1280,752)
        crop=image.crop((*origin,origin[0]+size[0],origin[1]+size[1]));path=folder/f'native-{name}-{zoom}.png';crop.save(path)
        native=np.array(crop.convert('RGB'));app=np.array(Image.open(baseline/f'app-{zoom}.png').convert('RGB'))
        comparisons=[]
        for i,(x,y,w,h) in enumerate(currentRegions):
            def bounds(a):
                p=a[y:y+h,x:x+w].astype(float)
                # JPEG chroma subsampling moves RGB thresholds independently of
                # the edge's luminance. Use the red/white luminance midpoint and
                # loose chroma checks, excluding black borders and white handles.
                lum=.299*p[:,:,0]+.587*p[:,:,1]+.114*p[:,:,2]
                yy,xx=np.where((lum<166)&(p[:,:,0]>128)&(p[:,:,0]>p[:,:,1]+32)&(p[:,:,0]>p[:,:,2]+32))
                assert len(xx)>0
                return [int(xx.min()+x),int(yy.min()+y),int(xx.max()+x+1),int(yy.max()+y+1)]
            n,b=bounds(native),bounds(app)
            comparisons.append(dict(id=i+1,native=n,baseline=b,equal=n==b))
        observations.append(dict(zoom=zoom,origin=origin,size=size,crop=path.name,cropSha256=sha(path),captureSha256=sha(capture),regions=currentRegions,redThreshold=dict(luminanceLessThan=166,luminanceWeights=[.299,.587,.114],rGreaterThan=128,redDominanceGreaterThan=32),comparisons=comparisons))
        print(name,zoom,'red-bound mismatches:',sum(not c['equal'] for c in comparisons),'of 16')
    physical=[]
    for i,(rect,cell) in enumerate(zip(red,layout[0]['cells'])):
        x,y,w,h=rect
        physical.append(dict(id=i+1,fillRectanglePdfPt=rect,fillBoundsPt=[x,216-y-h,x+w,216-y],baselineCellBoundsPt=[cell['x']*.75,cell['y']*.75,(cell['x']+cell['width'])*.75,(cell['y']+cell['height'])*.75]))
    result['controls'].append(dict(source=source.name,cases=cases.name,sourceSha256=sha(source),casesSha256=sha(cases),pdfSha256=sha(pdf),physical=physical,blackFramesUnchanged=name=='filled',observations=observations))
# A 600dpi truncation hypothesis explains three edges but still fails bottoms.
# Keep every counterexample; no production change follows from a partial fit.
model=dict(quantumCssPx=.16,epsilon=1e-7,frames=0,matchingEdges=[0,0,0,0],counterexamples=[],referenceHashes={})
q=lambda v:math.floor((v-1e-7)/.16)*.16
snap=lambda v:math.floor(v+.5+1e-7)
for name in ['control','holdout','reordered']:
    path=folder/('reference.json' if name=='control' else f'native-{name}-reference.json')
    model['referenceHashes'][path.name]=sha(path)
    cases=json.loads((folder/('cases.json' if name=='control' else f'{name}-cases.json')).read_text())
    obs=json.loads(path.read_text())['observations']+(screen['observations'] if name=='control' else [])
    for o in obs:
        s=o['zoom']/100
        for c,b in zip(cases,o['comparisons']):
            x,y=c['xTwips']/15,c['yTwips']/15;w=c['size']/6;d=math.floor(w*s+1e-7)
            predicted=[snap(q(x)*s)+min(0,d-1),snap(q(y)*s),snap(q(x+c['widthTwips']/15)*s)+d,snap(q(y+c['heightTwips']/15+w)*s)]
            model['frames']+=1
            for axis in range(4):model['matchingEdges'][axis]+=int(predicted[axis]==b['native'][axis])
            if predicted!=b['native']:model['counterexamples'].append(dict(source=name,zoom=o['zoom'],id=c['id'],predicted=predicted,native=b['native']))
model['referenceHashes']['native-intermediate-reference.json']=sha(folder/'native-intermediate-reference.json')
result['rejected600DpiFrameModel']=model
print('600dpi hypothesis matches left/top/right edges:',model['matchingEdges'],'of',model['frames'],'each; complete-frame counterexamples:',len(model['counterexamples']))
(folder/'native-fill-reference.json').write_text(json.dumps(result,indent=2)+'\n')
