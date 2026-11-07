"""Bind original native observations and compare the three fill-placement probes."""
from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
from PIL import Image, JpegImagePlugin
import numpy as np
import json
import math
import sys

root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/outline-fill-holdouts'
work=Path(sys.argv[1]);digest=lambda p:sha256(p.read_bytes()).hexdigest()
ref=dict(scope='Native JPEG screen observations, not an exact antialiasing oracle.',sources={},observations=[])
report=dict(baseline='6f8de2b0',comparisons=[],captures=[])
directories={'isolated':work/'outline-fill-candidate','fills':work/'outline-fill-projection','fillStroke':work/'outline-fill-stroke-projection'}
for mode,directory in directories.items():
    captures=json.loads((directory/'results.json').read_text())
    assert all(not c['readOnly'] and not c['errors'] and c['pages']==1 for c in captures)
    for capture in captures:
        p=directory/f"{capture['name']}-{capture['mode']}-{round(capture['zoom']*100)}.png"
        report['captures'].append(dict(experiment=mode,**capture,pngSha256=digest(p)))
for name in ['combined','group']:
    source=out/(name+'.docx')
    with ZipFile(source) as a,ZipFile(work/f'outline-fill-{name}.docx') as b:
        assert set(a.namelist())==set(b.namelist()) and all(a.read(n)==b.read(n) for n in a.namelist())
    ref['sources'][name]=dict(sha256=digest(source),casesSha256=digest(out/(name+'-cases.json')))
    cases=json.loads((out/(name+'-cases.json')).read_text())
    for zoom in [100,200]:
        scale=zoom/100;ox,oy=(439,310) if zoom==100 else (247,212)
        original=work/f'fill-{name}-{zoom}.jpg';raw=Image.open(original)
        assert raw.format=='JPEG' and raw.size==(1280,752)
        crop=raw.crop((ox,oy,ox+round(384*scale),oy+(288 if zoom==100 else 517)))
        native=np.asarray(crop.convert('RGB'),dtype=float);regions=[]
        for case in cases:
            x=math.floor(case['xCss']*scale)-3;y=math.floor(case['yCss']*scale)-3
            w,h=round(64*scale)+7,round(40*scale)+7
            region=native[y:y+h,x:x+w];assert region.shape==(h,w,3)
            assert np.all(region[:,:,0]==region[:,:,1]) and np.all(region[:,:,1]==region[:,:,2]),'Colored cursor/overlay'
            regions.append([x,y,w,h])
        target=out/f'native-{name}-{zoom}.png';crop.save(target)
        ref['observations'].append(dict(fixture=name,zoom=zoom,origin=[ox,oy],crop=target.name,cropSha256=digest(target),
            originalSha256=digest(original),originalFormat=raw.format,jpegSubsampling=JpegImagePlugin.get_sampling(raw),
            jpegQuantization=raw.quantization,regions=regions))
        baseline=np.asarray(Image.open(directories['isolated']/f'{name}-baseline-{zoom}.png').convert('RGB'),dtype=float)
        for mode,directory in directories.items():
            other=np.asarray(Image.open(directory/f'{name}-baseline-{zoom}.png').convert('RGB'),dtype=float)
            assert np.array_equal(other,baseline),'Changing baseline between experiments'
            candidate=np.asarray(Image.open(directory/f'{name}-{mode}-{zoom}.png').convert('RGB'),dtype=float)
            measurements=[]
            for i,(x,y,w,h) in enumerate(regions):
                region=np.s_[y:y+h,x:x+w,:]
                before=float(np.abs(baseline[region]-native[region]).mean())
                after=float(np.abs(candidate[region]-native[region]).mean())
                measurements.append(dict(id=i+1,baselineMAE=before,candidateMAE=after))
                if mode=='fillStroke':assert after<=before,(name,zoom,i+1,before,after)
            report['comparisons'].append(dict(fixture=name,zoom=zoom,mode=mode,regions=measurements))
planner=work/'outline-final-planner'
final_captures=json.loads((planner/'results.json').read_text())
assert all(not c['readOnly'] and not c['errors'] and c['pages']==1 for c in final_captures)
for capture in final_captures:
    p=planner/f"{capture['name']}-{capture['mode']}-{round(capture['zoom']*100)}.png"
    report['captures'].append(dict(experiment='final-planner',**capture,pngSha256=digest(p)))
native_edge=Image.open(work/'planner-bottom-native-100.jpg')
assert native_edge.format=='JPEG' and native_edge.size==(1280,752)
n=np.asarray(native_edge.convert('RGB'))
app=np.asarray(Image.open(planner/'corpus-fillStroke-100.png').convert('RGB'))
assert float(np.median(app[1006,100:700,0]))==255
assert float(np.median(app[1007,100:700,0]))==float(np.median(n[664,300:1000,0]))==213
report['plannerEdge100']=dict(nativeCaptureSha256=digest(work/'planner-bottom-native-100.jpg'),
    nativePageBottomExclusive=713,inferredPageTop=-343,
    nativeRows=[dict(y=y,medianRed=float(np.median(n[y,300:1000,0]))) for y in range(660,669)],
    candidateRows=[dict(y=y,medianRed=float(np.median(app[y,100:700,0]))) for y in range(1003,1012)])
(out/'reference.json').write_text(json.dumps(ref,indent=2)+'\n')
(root/'tests/fixtures/measurements/outline-fill-placement.json').write_text(json.dumps(report,indent=2)+'\n')
final=[r for c in report['comparisons'] if c['mode']=='fillStroke' for r in c['regions']]
print(f"Bound 32 original shapes and 64 neutral native regions; {sum(r['candidateMAE']<r['baselineMAE'] for r in final)} improved, {sum(r['candidateMAE']==r['baselineMAE'] for r in final)} unchanged, none regressed.")
