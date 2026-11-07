"""Original polynomial-evaluation and threshold hypotheses; no runtime changes.

Hash-bound primitive API evidence only. No corpus curves, reference-application UI observations,
or automatic selection of a rendering algorithm.
"""
from pathlib import Path
import argparse,gzip,hashlib,json
import numpy as np
from probe_svg_cubic_state_representations import references
from probe_svg_cubic_arithmetic import candidate
from probe_svg_cubic_flatten import quantized_input

ROOT=Path(__file__).resolve().parents[1]
sha=lambda b:hashlib.sha256(b).hexdigest()

def parameters(points):
    p=(points*16*2**14).astype(np.int64)
    e2,e3=3*(p[0]-2*p[1]+p[2]),3*(p[1]-2*p[2]+p[3])
    t,step,result=0.,1.,[0.]
    error=lambda a,b:max(np.max(abs(a)),np.max(abs(b)))
    while t<1:
        while error(e2,e3)>12*2**14:
            e3=(e2+e3)//8;e2=e2//4;step/=2
            if step<2**-16:raise ValueError('Subdivision bound exceeded')
        while step<1 and t%(2*step)==0 and t+2*step<=1:
            a,b=4*e2,8*e3-4*e2
            if error(a,b)>12*2**14:break
            e2,e3=a,b;step*=2
        e2,e3=e3,2*e3-e2;t+=step;result.append(t)
        if len(result)>4096:raise ValueError('Vertex bound exceeded')
    return result

def direct(points,ts,model,bits):
    if bits not in (32,64) or model not in ('bernstein','horner','horner-nested','casteljau'):raise ValueError('Unknown model')
    dtype=np.float32 if bits==32 else np.float64
    p=np.asarray(points,dtype=dtype);result=[];a,b,c,d=p
    for value in ts:
        t=dtype(value);u=dtype(1)-t
        if model=='bernstein':v=u*u*u*a+3*u*u*t*b+3*u*t*t*c+t*t*t*d
        elif model=='horner':v=((-a+3*b-3*c+d)*t+(3*a-6*b+3*c))*t*t+(-3*a+3*b)*t+a
        elif model=='horner-nested':v=(((-a+3*b-3*c+d)*t+(3*a-6*b+3*c))*t+(-3*a+3*b))*t+a
        else:
            q=p.copy()
            for length in (3,2,1):q=q[:length]*u+q[1:length+1]*t
            v=q[0]
        result.append(np.floor(v.astype(float)*16+.5)/16)
    return np.asarray(result)

def affine_references():
    folder=ROOT/'tests/fixtures/svg-cubic-state-controls';ref=json.loads((folder/'reference.json').read_bytes())
    for name,expected in ref['sourceHashes'].items():assert sha((ROOT/name).read_bytes())==expected
    for name,expected in ref['compressed'].items():assert sha((folder/name).read_bytes())==expected
    data=gzip.decompress((folder/'cases.json.gz').read_bytes());raw=gzip.decompress((folder/'native-api.json.gz').read_bytes())
    assert sha(data)==ref['inputSha256'] and sha(raw)==ref['captureSha256']
    cases=json.loads(data);native=json.loads(raw.decode('utf-8-sig'))
    assert native['inputSha256']==ref['inputSha256'] and native['quantizeInput'] and native['tolerance']==.25
    assert len(cases)==len(native['cases'])
    assert [c['name'] for c in cases]==[c['name'] for c in native['cases']]
    return cases,native['cases'],ref['compressed']

def probe():
    report=[]
    for family in ('svg-cubic-flatten-sweep','svg-cubic-terminal-rounding','svg-cubic-step-changes','svg-cubic-step-split','svg-cubic-state-controls'):
        cases,native,hashes=affine_references() if family.endswith('state-controls') else references(family)
        samples=[];count_gaps=[]
        for c,n in zip(cases,native,strict=True):
            p=quantized_input(c['points']);expected=np.asarray(n['points']).reshape(-1,2);baseline=candidate(p);ts=parameters(p)
            assert len(ts)==len(baseline)
            samples.append((c,p,ts,expected,np.array_equal(baseline,expected)))
            if len(baseline)!=len(expected):
                count_gaps.append(dict(case=c['name'],points=c['points'],currentCount=len(baseline),nativeCount=len(expected),
                  currentBounds=[baseline.min(0).tolist(),baseline.max(0).tolist()],nativeBounds=[expected.min(0).tolist(),expected.max(0).tolist()],
                  currentDuplicateRows=sum(np.array_equal(a,b) for a,b in zip(baseline,baseline[1:])),nativeDuplicateRows=sum(np.array_equal(a,b) for a,b in zip(expected,expected[1:]))))
        configurations=[dict(model=m,bits=b) for b in (32,64) for m in ('bernstein','horner','horner-nested','casteljau')]
        configurations += [dict(model='threshold',initial_strict=i,coarsen_strict=c) for i in (False,True) for c in (False,True)]
        rows=[]
        for config in configurations:
            results=[]
            for c,p,ts,expected,baseline in samples:
                actual=candidate(p,**{k:v for k,v in config.items() if k!='model'}) if config['model']=='threshold' else direct(p,ts,**config)
                results.append(dict(case=c['name'],exact=bool(np.array_equal(actual,expected)),baselineExact=bool(baseline),matchingCounts=actual.shape==expected.shape))
            rows.append(dict(config=config,exact=sum(r['exact'] for r in results),improvements=sum(r['exact'] and not r['baselineExact'] for r in results),
                regressions=sum(not r['exact'] and r['baselineExact'] for r in results),matchingCounts=sum(r['matchingCounts'] for r in results),
                changed=[r for r in results if r['exact']!=r['baselineExact']]))
        report.append(dict(family=family,total=len(cases),referenceHashes=hashes,countGaps=count_gaps,results=rows))
    return dict(scope=__doc__,families=report)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path);args=parser.parse_args()
    result=probe();args.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    for f in result['families']:print(f['family'],len(f['countGaps']),'vertex-count gaps;',[(r['config'],r['exact'],r['regressions']) for r in f['results']],flush=True)
