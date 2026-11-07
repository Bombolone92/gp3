"""Check held-out reference coordinate captures against previously plausible paths.

Native raw device bounds are observations, not a PDF projection algorithm.
"""
import argparse, json, math
from pathlib import Path
from check_print_row_coordinate_paths import ROOT, compare, f32, nearest, sha

PATHS = {
    'floatTermsDoubleSum': lambda top, row, pen: nearest(
        (f32(top*f32(.05))+f32(row*f32(.05))+f32(pen*f32(.05)))/.12),
    'floatRowPenDoubleSum': lambda top, row, pen: nearest(
        (f32(top*f32(.05))+f32((row+pen)*f32(.05)))/.12),
    'floatTopPenDoubleSum': lambda top, row, pen: nearest(
        (f32((top+pen)*f32(.05))+f32(row*f32(.05)))/.12),
    'doubleTopFloatRowPen': lambda top, row, pen: nearest(
        (top/20+f32(row*f32(.05))+f32(pen*f32(.05)))/.12),
}

def held_out_rows():
    folder = ROOT/'tests/fixtures/print-coordinate-phase'
    path = folder/'native-metafile-rectangles.json'
    native = json.loads(path.read_bytes())
    cases = json.loads((folder/'cases.json').read_bytes())
    assert sha(folder/'control.docx') == native['sourceSha256']
    assert sha(folder/'cases.json') == native['casesSha256']
    assert native['sourceUnchanged'] and len(cases) == len(native['pages']) == 80
    rows = []
    for index, (case, page) in enumerate(zip(cases, native['pages'])):
        assert case['index'] == case['page'] == index and page['page'] == index+1
        assert page['windowExtent'] == [5100, 6600]
        assert [page['widthPt'], page['heightPt']] == [612, 792]
        blue = [r for r in page['fills'] if r['colorRef'] == 0x917f6d]
        assert len(blue) == 12 and all(not r['clips'] for r in blue)
        rows.append(dict(fixture=folder.name, index=index, topTwips=case['topTwips'],
            heightTwips=case['heightTwips'], sizeEighthPoints=case['sizeEighthPoints'],
            nativeFarUnits=max(y+h for x,y,w,h in [r['destination'] for r in blue])))
    control = dict(fixture=folder.name, cases=80, sourceSha256=native['sourceSha256'],
        casesSha256=native['casesSha256'], rawReferenceSha256=sha(path))
    return control, rows

def report():
    prior = compare()
    control, new = held_out_rows()
    fields = ['fixture','index','topTwips','heightTwips','sizeEighthPoints','nativeFarUnits']
    rows = [{k:r[k] for k in fields} for r in prior['rows']] + new
    for row in rows:
        top, height, pen = row['topTwips'], row['heightTwips'], math.floor(row['sizeEighthPoints']*2.5)
        row['predicted'] = {key:fn(top,height,pen) for key,fn in PATHS.items()}
    results = {}
    for key in PATHS:
        bad = [r for r in rows if r['predicted'][key] != r['nativeFarUnits']]
        results[key] = dict(priorMismatches=sum(r['fixture'] != control['fixture'] for r in bad),
            heldOutMismatches=sum(r['fixture'] == control['fixture'] for r in bad), counterexamples=bad)
    return dict(scope='Raw 600dpi PATCOPY far edges only; not PDF, live screen, flowing tables or a production implementation',
        priorCases=156, heldOutCases=80, controls=prior['controls']+[control], paths=results, rows=rows)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = report()
    if args.output: args.output.write_bytes((json.dumps(result,indent=2)+'\n').encode())
    print(json.dumps({key:{k:v for k,v in value.items() if k!='counterexamples'} for key,value in result['paths'].items()}))
