"""Reject the local-float extent hypothesis using predictions frozen pre-capture."""
import argparse,json,math
from pathlib import Path
from check_print_coordinate_holdouts import report as prior_report
from check_print_row_coordinate_paths import ROOT,f32,nearest,sha


def predict(case):
    row = f32(case['heightTwips'] * f32(.05))
    border = f32(math.floor(case['sizeEighthPoints'] * 2.5) * f32(.05))
    end = case['topTwips'] / 20 + f32(row + border)
    return {'index':case['index'],'preDevicePt':end,'predictedFarUnits':nearest(end/.12)}


def report():
    prior = prior_report()
    prior_misses = [row for row in prior['rows']
                    if predict(row)['predictedFarUnits'] != row['nativeFarUnits']]
    folder = ROOT/'tests/fixtures/print-coordinate-independent-phase'
    native_path = folder/'native-metafile-rectangles.json'
    native = json.loads(native_path.read_bytes())
    cases = json.loads((folder/'cases.json').read_bytes())
    frozen_path = folder/'frozen-predictions.json'
    frozen = json.loads(frozen_path.read_bytes())
    assert native['sourceUnchanged']
    assert sha(folder/'control.docx') == native['sourceSha256'] == frozen['sourceSha256']
    assert sha(folder/'cases.json') == native['casesSha256'] == frozen['casesSha256']
    assert len(cases) == len(native['pages']) == len(frozen['predictions']) == 80
    assert [predict(case) for case in cases] == frozen['predictions']
    rows = []
    for case,page,prediction in zip(cases,native['pages'],frozen['predictions']):
        assert page['page'] == case['index']+1 == case['page']+1
        assert page['windowExtent'] == [5100,6600]
        assert [page['widthPt'],page['heightPt']] == [612,792]
        blue = [r for r in page['fills'] if r['colorRef'] == 0x917f6d]
        assert len(blue) == 12 and all(not r['clips'] for r in blue)
        far = max(y+h for x,y,w,h in [r['destination'] for r in blue])
        rows.append({**case,**prediction,'nativeFarUnits':far,
                     'matches':far==prediction['predictedFarUnits']})
    range_path=folder/'native-table-range-rectangles.json'
    ranges=json.loads(range_path.read_bytes())
    metadata=ranges['metadata']
    assert metadata['sourceSha256']==native['sourceSha256']
    assert metadata['sourceUnchanged'] and metadata['savedBefore'] and metadata['savedAfter']
    assert metadata['viewBefore']==metadata['viewAfter']
    assert [r['index'] for r in ranges['rows']]==[12,13,72,79]
    range_rows=[]
    for local in ranges['rows']:
        assert local['sha256']==next(t['sha256'] for t in metadata['tables'] if t['index']==local['index'])
        page=native['pages'][local['index']]
        def ink(record):
            rects=[r['destination'] for r in record['fills'] if r['colorRef']==0x917f6d]
            assert len(rects)==12 and all(not r['clips'] for r in record['fills'] if r['colorRef']==0x917f6d)
            return rects
        local_ink,page_ink=ink(local),ink(page)
        x=min(r[0] for r in page_ink)-min(r[0] for r in local_ink)
        y=min(r[1] for r in page_ink)-min(r[1] for r in local_ink)
        assert [[rx+x,ry+y,w,h] for rx,ry,w,h in local_ink]==page_ink
        range_rows.append({'index':local['index'],'pageTranslationUnits':[x,y],
                           'localFarUnits':max(ry+h for rx,ry,w,h in local_ink)})
    return {'scope':'Raw 600dpi table far-edge diagnostic. Frozen local-float extent '
                    'hypothesis rejected; not PDF/screen placement or a renderer change.',
            'priorCases':len(prior['rows']),'priorMismatches':len(prior_misses),
            'heldOutCases':len(rows),'heldOutMismatches':sum(not r['matches'] for r in rows),
            'priorControls':prior['controls'],
            'control':{'sourceSha256':native['sourceSha256'],'casesSha256':native['casesSha256'],
                       'rawReferenceSha256':sha(native_path),
                       'frozenPredictionsSha256':sha(frozen_path),'referenceBuild':native['referenceBuild'],
                       'tableRangeReferenceSha256':sha(range_path)},
            'tableRangeObservations':range_rows,'rows':rows}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args();result=report()
    if args.output:args.output.write_bytes((json.dumps(result,indent=2)+'\n').encode())
    print(json.dumps({k:v for k,v in result.items() if k in
          ['priorCases','priorMismatches','heldOutCases','heldOutMismatches']}))
