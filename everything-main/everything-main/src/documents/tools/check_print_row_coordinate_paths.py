"""Compare rejected arithmetic hypotheses with independent native raw bounds.

These are far-edge hypotheses, not a renderer or a PDF projection algorithm.
"""
from pathlib import Path
import argparse, hashlib, json, math, struct

ROOT=Path(__file__).resolve().parents[1]
CONTROLS=['print-paper-height-phase','print-paper-phase','print-row-phase',
          'print-story-margin-phase','print-tie-phase','print-row-pen-phase']
f32=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
nearest=lambda x:math.floor(x+.5)
PATHS={
 'wholeTwipDouble':lambda top,row,pen:nearest((top+row+pen)/2.4),
 'floatPointSum':lambda top,row,pen:nearest(f32(f32(f32(top/20)+f32(row/20))+f32(pen/20))/.12),
 'floatFactorSequential':lambda top,row,pen:nearest(f32(f32(f32(top*f32(.05))+f32(row*f32(.05)))+f32(pen*f32(.05)))/.12),
 'floatFactorBorderFirst':lambda top,row,pen:nearest(f32(f32(f32(top*f32(.05))+f32(pen*f32(.05)))+f32(row*f32(.05)))/.12),
 'floatTwipSumFactor':lambda top,row,pen:nearest(f32((top+row+pen)*f32(.05))/.12),
}
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()

def compare():
    controls=[];rows=[]
    for name in CONTROLS:
        folder=ROOT/'tests/fixtures'/name
        path=folder/'native-metafile-rectangles.json'
        native=json.loads(path.read_bytes());cases=json.loads((folder/'cases.json').read_bytes())
        assert sha(folder/'control.docx')==native['sourceSha256']
        assert sha(folder/'cases.json')==native['casesSha256']
        assert native['sourceUnchanged'] and len(cases)==len(native['pages'])
        controls.append(dict(fixture=name,cases=len(cases),sourceSha256=native['sourceSha256'],
            casesSha256=native['casesSha256'],rawReferenceSha256=sha(path)))
        for case,page in zip(cases,native['pages']):
            assert case['page']+1==page['page']
            assert all(abs(point/unit-.12)<1e-9 for point,unit in zip([page['widthPt'],page['heightPt']],page['windowExtent']))
            blue=[item['destination'] for item in page['fills'] if item['colorRef']==0x917f6d]
            assert len(blue)==12 and all(not item['clips'] for item in page['fills'] if item['colorRef']==0x917f6d)
            far=max(y+h for x,y,w,h in blue)
            top=case.get('topTwips',720);row=case['heightTwips'];pen=math.floor(case['sizeEighthPoints']*2.5)
            rows.append(dict(fixture=name,index=case['index'],topTwips=top,heightTwips=row,
                sizeEighthPoints=case['sizeEighthPoints'],nativeFarUnits=far,
                predicted={key:fn(top,row,pen) for key,fn in PATHS.items()}))
    return dict(scope='Raw 600dpi native PATCOPY far-edge bounds only; not PDF, screen, flowing tables or a production implementation',
        controls=controls,cases=len(rows),paths={key:dict(mismatches=sum(r['predicted'][key]!=r['nativeFarUnits'] for r in rows),
        counterexamples=[r for r in rows if r['predicted'][key]!=r['nativeFarUnits']]) for key in PATHS},rows=rows)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args();result=compare()
    if args.output:args.output.write_bytes((json.dumps(result,indent=2)+'\n').encode())
    print(json.dumps({'cases':result['cases'],'mismatches':{k:v['mismatches'] for k,v in result['paths'].items()}}))
