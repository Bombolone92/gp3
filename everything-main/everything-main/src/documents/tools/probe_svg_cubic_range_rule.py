"""Range/state hypotheses against original controls; no production selection."""
from pathlib import Path
import argparse,gzip,hashlib,json
import numpy as np
from probe_svg_cubic_arithmetic import candidate
from probe_svg_cubic_sampling import affine_references
from probe_svg_cubic_state_representations import references
from probe_svg_cubic_flatten import quantized_input
from svg_cubic_range_holdouts import inputs

ROOT=Path(__file__).resolve().parents[1]


def holdouts():
    folder=ROOT/'tests/fixtures/svg-cubic-range-holdouts'
    ref=json.loads((folder/'reference.json').read_bytes())
    for name,expected in ref['compressed'].items():
        assert hashlib.sha256((folder/name).read_bytes()).hexdigest()==expected
    families=[]
    for name,rows in inputs().items():
        raw=gzip.decompress((folder/(name+'.gz')).read_bytes())
        assert raw==(json.dumps(rows,indent=2)+'\n').encode()
        native=json.loads(gzip.decompress((folder/(name.replace('cases','native')+'.gz')).read_bytes()).decode('utf-8-sig'))
        assert native['inputSha256']==hashlib.sha256(raw).hexdigest()
        assert native['quantizeInput'] and native['tolerance']==.25
        assert [r['name'] for r in native['cases']]==[r['name'] for r in rows]
        families.append((name,rows,native['cases']))
    return families


def range_candidate(points):
    if np.ptp(points,axis=0).max()>=1023:
        return candidate(points,precision=18,error_units=32)
    return candidate(points)


def samples(cases,native):
    result=[]
    for c,n in zip(cases,native,strict=True):
        assert c['name']==n['name']
        p=quantized_input(c['points']);e=np.asarray(n['points']).reshape(-1,2)
        result.append((c['name'],p,e,bool(np.array_equal(candidate(p),e))))
    return result


def compare(values,func):
    rows=[]
    for name,p,e,baseline in values:
        actual=func(p)
        rows.append(dict(case=name,exact=bool(np.array_equal(actual,e)),baselineExact=baseline,matchingCount=actual.shape==e.shape))
    return dict(total=len(rows),baselineExact=sum(r['baselineExact'] for r in rows),exact=sum(r['exact'] for r in rows),
        improvements=sum(r['exact'] and not r['baselineExact'] for r in rows),
        regressions=sum(r['baselineExact'] and not r['exact'] for r in rows),
        matchingCounts=sum(r['matchingCount'] for r in rows),
        changed=[r for r in rows if r['exact']!=r['baselineExact']])


def probe():
    range_rows=[]
    for name,cases,native in holdouts():
        range_rows.append(dict(family=name,**compare(samples(cases,native),range_candidate)))
    half_rows=[]
    for family in ['svg-cubic-flatten-sweep','svg-cubic-terminal-rounding','svg-cubic-step-changes','svg-cubic-step-split','svg-cubic-state-controls']:
        cases,native,_=affine_references() if family.endswith('state-controls') else references(family)
        values=samples(cases,native);models=[]
        for half in ['exact-floor','exact-truncate','quarter-floor','quarter-truncate','nearest']:
            for precision in [12,13,14,15,16,18]:
                models.append(dict(halfDelta=half,precision=precision,**compare(values,lambda p:candidate(p,half_delta=half,precision=precision))))
        half_rows.append(dict(family=family,rangeRule=compare(values,range_candidate),halfModels=models))
    return dict(scope=__doc__,rangeModel=dict(minimumQuantizedControlSpan=1023,errorUnits=32,precision=18,
        status='Diagnostic only: vertex schedules improve, coordinate mismatches remain. Not a production algorithm.'),rangeFamilies=range_rows,halfFamilies=half_rows)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path)
    args=parser.parse_args();result=probe();args.output.write_bytes((json.dumps(result,indent=2)+'\n').encode())
    for row in result['rangeFamilies']:print(row['family'],row['baselineExact'],row['exact'],row['matchingCounts'],row['regressions'],flush=True)
