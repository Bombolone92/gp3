"""Test forward-difference and midpoint state against authored native controls.

Unlike the earlier Float32 integer-division probe, these models retain floating
state during halving. Fixed midpoint controls test a different state basis.
This diagnostic never selects production behavior or uses
corpus contours. API vertex agreement is separate from native raster fidelity.
"""
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np
from probe_svg_cubic_flatten import quantized_input
from probe_svg_cubic_arithmetic import candidate

ROOT = Path(__file__).resolve().parents[1]/'tests/fixtures'


def floating_state(points, bits=32, rounding='up', combined_half=False):
    dtype = np.float32 if bits == 32 else np.float64
    cast = lambda value: np.asarray(value, dtype=dtype)
    p = cast(points*16)
    position, delta = p[0].copy(), cast(p[3]-p[0])
    e2 = cast(3*cast(cast(p[0]-cast(2*p[1]))+p[2]))
    e3 = cast(3*cast(cast(p[1]-cast(2*p[2]))+p[3]))
    t, step, result = 0., 1., [position.copy()]
    error = lambda a,b: max(float(np.max(abs(a))),float(np.max(abs(b))))
    while t < 1:
        while error(e2,e3) > 12:
            old_delta = delta
            e3 = cast(cast(e2+e3)/8)
            delta = cast(cast(old_delta/2)-e3) if not combined_half else cast(cast(old_delta-cast(2*e3))/2)
            e2 = cast(e2/4)
            step /= 2
            if step < 2**-16:
                raise ValueError('Subdivision bound exceeded')
        while step < 1 and t % (2*step) == 0 and t+2*step <= 1:
            next2, next3 = cast(4*e2),cast(cast(8*e3)-cast(4*e2))
            if error(next2,next3) > 12:
                break
            delta,e2,e3 = cast(cast(2*delta)+cast(2*e3)),next2,next3
            step *= 2
        position = cast(position+delta)
        delta = cast(delta+cast(2*e3))
        e2,e3 = e3,cast(cast(2*e3)-e2)
        t += step
        result.append(position.copy())
        if len(result)>4096:
            raise ValueError('Vertex bound exceeded')
    values = np.asarray(result,dtype=float)
    rounded = np.floor(values+.5) if rounding == 'up' else np.round(values)
    return rounded/16


def references(family):
    folder = ROOT/family
    source = 'api-cases.json' if family.endswith('split') else 'cases.json'
    capture = 'native-quantized.json' if family.endswith('sweep') else 'native-api.json'
    data, captured = (folder/source).read_bytes(),(folder/capture).read_bytes()
    cases,native = json.loads(data),json.loads(captured.decode('utf-8-sig'))
    assert native['inputSha256'] == hashlib.sha256(data).hexdigest()
    assert native['quantizeInput'] and native['tolerance'] == .25
    assert len(cases) == len(native['cases'])
    for case,row in zip(cases,native['cases'],strict=True):
        assert case['name'] == row['name']
    return cases,native['cases'],{source:hashlib.sha256(data).hexdigest(),capture:hashlib.sha256(captured).hexdigest()}


def midpoint_state(points, precision=12, division='floor'):
    """Independent de Casteljau control state, not finite-difference state."""
    scale=16*2**precision
    p=np.asarray(points*scale,dtype=np.int64)
    result=[p[0].copy()]
    def half(a,b):
        value=a+b
        if division=='floor':return value//2
        if division=='up':return (value+1)//2
        return np.round(value/2).astype(np.int64)
    def visit(p,depth=0):
        error=max(np.max(abs(p[0]-2*p[1]+p[2])),np.max(abs(p[1]-2*p[2]+p[3])))
        if error<=scale/4:
            result.append(p[3].copy())
            if len(result)>4096:raise ValueError('Vertex bound exceeded')
            return
        if depth>=16:raise ValueError('Subdivision bound exceeded')
        a,b,c=half(p[0],p[1]),half(p[1],p[2]),half(p[2],p[3])
        d,e=half(a,b),half(b,c)
        f=half(d,e)
        visit(np.asarray([p[0],a,d,f]),depth+1)
        visit(np.asarray([f,e,c,p[3]]),depth+1)
    visit(p)
    return np.floor(np.asarray(result)/2**precision+.5)/16


def probe():
    configs = [dict(model='floating',bits=bits,rounding=rounding,combined_half=combined)
               for bits in [32,64] for rounding in ['up','even'] for combined in [False,True]]
    configs += [dict(model='midpoint',precision=p,division=d) for p in range(23) for d in ['floor','up','even']]
    families=[]
    for family in ['svg-cubic-flatten-sweep','svg-cubic-terminal-rounding','svg-cubic-step-changes','svg-cubic-step-split']:
        cases,native,hashes=references(family)
        results=[]
        for config in configs:
            rows=[]
            for case,row in zip(cases,native,strict=True):
                points=quantized_input(case['points']);expected=np.asarray(row['points']).reshape(-1,2)
                baseline=candidate(points)
                arguments={k:v for k,v in config.items() if k!='model'}
                actual=(floating_state if config['model']=='floating' else midpoint_state)(points,**arguments)
                rows.append(dict(case=case['name'],exact=bool(np.array_equal(actual,expected)),
                                 baselineExact=bool(np.array_equal(baseline,expected)),
                                 matchingVertexCount=actual.shape==expected.shape,
                                 changedCoordinates=int(np.count_nonzero(actual!=expected)) if actual.shape==expected.shape else None))
            results.append(dict(config=config,exact=sum(r['exact'] for r in rows),
                                improvements=sum(r['exact'] and not r['baselineExact'] for r in rows),
                                regressions=sum(r['baselineExact'] and not r['exact'] for r in rows),rows=rows))
        families.append(dict(family=family,total=len(cases),referenceHashes=hashes,results=results))
    return dict(scope=__doc__,families=families)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    result=probe()
    args.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    for family in result['families']:
        best=max(r['exact'] for r in family['results'])
        print(f"{family['family']}: {len(family['results'])} models; best {best}/{family['total']}")
