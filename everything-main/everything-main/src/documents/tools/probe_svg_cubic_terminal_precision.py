"""Compare terminal rounding/low-precision hypotheses without changing rendering."""
from pathlib import Path
import argparse,json,hashlib
import numpy as np
from probe_svg_cubic_arithmetic import candidate
from probe_svg_cubic_flatten import quantized_input

ROOT=Path(__file__).resolve().parents[1]

def probe():
    families=['svg-cubic-flatten-sweep','svg-cubic-terminal-rounding']
    sources=[];hashes={}
    for family in families:
        folder=ROOT/'tests/fixtures'/family
        caseBytes=(folder/'cases.json').read_bytes()
        file='native-quantized.json' if family.endswith('sweep') else 'native-api.json'
        nativeBytes=(folder/file).read_bytes();native=json.loads(nativeBytes.decode('utf-8-sig'))
        assert native['inputSha256']==hashlib.sha256(caseBytes).hexdigest() and native['quantizeInput']
        cases=json.loads(caseBytes);assert len(cases)==len(native['cases'])
        sources.append((family,cases,native['cases']))
        hashes[family]={name:hashlib.sha256((folder/name).read_bytes()).hexdigest() for name in ['cases.json',file]}
    results=[]
    for config in [dict(precision=14),dict(rounding='even'),dict(rounding='down'),*[dict(precision=p) for p in range(10)]]:
        rows=[]
        for family,cases,native in sources:
            exact=0;errors=[];different=[]
            for c,n in zip(cases,native,strict=True):
                assert c['name']==n['name']
                try:actual=candidate(quantized_input(c['points']),**config)
                except ValueError as error:errors.append(dict(case=c['name'],error=str(error)));continue
                if np.array_equal(actual,np.array(n['points']).reshape(-1,2)):exact+=1
                else:different.append(c['name'])
            rows.append(dict(family=family,total=len(cases),exact=exact,subdivisionErrors=errors,different=different))
        results.append(dict(config=config,rows=rows))
    return dict(scope='Native API vertex comparisons; native DOCX raster comparison is a separate browser check. No renderer correction.',referenceHashes=hashes,results=results)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path)
    data=probe();parser.parse_args().output.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
    print('Compared 13 models against 129 hash-bound API curves; no renderer change.')
