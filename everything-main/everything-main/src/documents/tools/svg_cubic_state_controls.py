"""Authored native API controls for cubic phase, sign and scale.

These are primitive GraphicsPath.Flatten observations, not native DOCX rendering
proof. Curves derive solely from the independent integer control fixture.
"""
from pathlib import Path
import argparse,gzip,hashlib,json
import numpy as np
from svg_cubic_step_fixture import split
from probe_svg_cubic_flatten import quantized_input
from probe_svg_cubic_arithmetic import candidate
from probe_svg_cubic_state_representations import midpoint_state

ROOT=Path(__file__).resolve().parents[1]
PHASES=[(0,0),(1/16,0),(0,1/16),(1/16,1/16),(.5,.5)]
SCALES=[.5,1,2,4]
AXES={'identity':[[1,0],[0,1]],'reflect-x':[[-1,0],[0,1]],'reflect-y':[[1,0],[0,-1]],'swap':[[0,1],[1,0]]}
sha=lambda b:hashlib.sha256(b).hexdigest()


def inputs():
    path=ROOT/'tests/fixtures/svg-cubic-step-changes/cases.json'
    data=path.read_bytes();source=json.loads(data);rows=[]
    def add(base,points,kind,transform):
        segments=[('whole',points),*zip(['left','right'],split(points),strict=True)]
        for representation,segment in segments:
            name=f'{base}/{kind}/{transform["name"]}/{representation}'
            rows.append(dict(name=name,base=base,kind=kind,representation=representation,
                             transform=transform,points=segment))
    for c in source:
        p=np.asarray(c['points'],dtype=float)
        for phase in PHASES:
            add(c['name'],(p+phase).tolist(),'phase',dict(name=f'{phase[0]},{phase[1]}',shift=list(phase)))
        local=p-p[0]
        for scale in SCALES:
            for name,matrix in AXES.items():
                add(c['name'],(scale*(local@np.asarray(matrix).T)).tolist(),'range',dict(name=f'{scale}/{name}',scale=scale,axes=name))
    return rows,{path.relative_to(ROOT).as_posix():sha(data)}


def generate(out):
    out.mkdir(parents=True,exist_ok=True)
    cases,sources=inputs()
    data=(json.dumps(cases,indent=2)+'\n').encode()
    (out/'cases.json').write_bytes(data)
    (out/'sources.json').write_text(json.dumps(sources,indent=2)+'\n',encoding='utf-8')
    return data


def record(out,capture,repeat=None):
    cases,sources=inputs();data=(json.dumps(cases,indent=2)+'\n').encode()
    assert (out/'cases.json').read_bytes()==data
    raw=capture.read_bytes();native=json.loads(raw.decode('utf-8-sig'))
    assert native['inputSha256']==sha(data) and native['quantizeInput'] and native['tolerance']==.25
    assert len(cases)==len(native['cases'])==504
    native_points={};rows=[]
    for c,n in zip(cases,native['cases'],strict=True):
        assert c['name']==n['name']
        expected=np.asarray(n['points']).reshape(-1,2)
        native_points[(c['base'],c['kind'],c['transform']['name'],c['representation'])]=expected
        points=quantized_input(c['points'])
        current=candidate(points);midpoint=midpoint_state(points,precision=6,division='even')
        rows.append(dict(name=c['name'],kind=c['kind'],representation=c['representation'],
                         nativeVertices=len(expected),currentExact=bool(np.array_equal(current,expected)),
                         midpointExact=bool(np.array_equal(midpoint,expected))))
    phase_rows=[];range_rows=[]
    for c in cases:
        if c['representation']!='whole':continue
        key=(c['base'],c['kind'],c['transform']['name'])
        whole=native_points[(*key,'whole')]
        halves=np.concatenate([native_points[(*key,'left')],native_points[(*key,'right')][1:]])
        entry=dict(base=c['base'],transform=c['transform'],wholeSplitEqual=bool(np.array_equal(whole,halves)),
                   vertexCounts=[len(whole),len(halves)])
        if c['kind']=='phase':
            for representation in ['whole','left','right']:
                shifted=native_points[(*key,representation)]-c['transform']['shift']
                original=native_points[(c['base'],'phase','0,0',representation)]
                entry[representation+'TranslationEqual']=bool(np.array_equal(shifted,original))
            phase_rows.append(entry)
        else:range_rows.append(entry)
    packed={}
    for name,content in [('cases.json',data),('native-api.json',raw)]:
        compressed=gzip.compress(content,mtime=0);(out/(name+'.gz')).write_bytes(compressed)
        packed[name+'.gz']=sha(compressed)
    result=dict(scope=__doc__,total=len(cases),sourceHashes=sources,inputSha256=sha(data),captureSha256=sha(raw),compressed=packed,
                currentExact=sum(r['currentExact'] for r in rows),midpointExact=sum(r['midpointExact'] for r in rows),
                phaseRows=phase_rows,rangeRows=range_rows,
                acceptedCurrentCaseNames=[r['name'] for r in rows if r['currentExact']])
    if repeat is not None:
        repeated=json.loads(repeat.read_bytes().decode('utf-8-sig'))
        assert repeated==native, 'Native recapture changed'
        result['nativeRecaptureExact']=True
    (out/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path);parser.add_argument('--native',type=Path);parser.add_argument('--repeat',type=Path)
    args=parser.parse_args()
    if args.native:
        r=record(args.output,args.native,args.repeat)
        print(json.dumps(dict(total=r['total'],currentExact=r['currentExact'],midpointExact=r['midpointExact'],
                             phaseTranslationsDifferent=sum(not all(x[k+'TranslationEqual'] for k in ['whole','left','right']) for x in r['phaseRows']))))
    else:print('Generated 504 API cases:',sha(generate(args.output)))
