"""Separate native row properties and coarse range positions from border ink."""
import argparse, json
from pathlib import Path
from check_print_row_coordinate_paths import ROOT, f32, sha

def analyze():
    folder = ROOT/'tests/fixtures/print-coordinate-phase'
    path = folder/'native-row-layout.json'
    native = json.loads(path.read_text(encoding='utf-8-sig'))
    cases = json.loads((folder/'cases.json').read_bytes())
    assert sha(folder/'control.docx') == native['sourceSha256']
    assert sha(folder/'cases.json') == native['casesSha256']
    assert native['sourceUnchanged'] and native['savedBefore'] and native['savedAfter']
    assert native['viewBefore'] == native['viewAfter']
    assert len(native['rows']) == len(cases) == 80
    rows = []
    for index, (case, row) in enumerate(zip(cases, native['rows'])):
        assert case['index'] == case['page'] == row['index'] == index and row['page'] == index+1
        assert row['rowHeightRule'] == 2
        assert row['rowHeightPt'] == row['cellHeightPt']
        rows.append(dict(index=index, heightTwips=case['heightTwips'], topTwips=case['topTwips'],
            sizeEighthPoints=case['sizeEighthPoints'], rowHeightPt=row['rowHeightPt'],
            directPointCast=f32(case['heightTwips']/20), floatFactorCast=f32(case['heightTwips']*f32(.05)),
            rangePageXPt=row['rangePageXPt'], rangePageYPt=row['rangePageYPt']))
    return dict(scope='Native API properties and cell-range positions only; not exact layout intermediates or border ink',
        sourceSha256=native['sourceSha256'], casesSha256=native['casesSha256'],
        nativeReferenceSha256=sha(path), referenceBuild=native['referenceBuild'], view=native['viewBefore'], cases=len(rows),
        directPointCastMismatches=sum(r['rowHeightPt'] != r['directPointCast'] for r in rows),
        floatFactorCastMismatches=sum(r['rowHeightPt'] != r['floatFactorCast'] for r in rows),
        unavailablePositions=[r['index'] for r in rows if -1 in [r['rangePageXPt'],r['rangePageYPt']]],
        observedPositionsOnThreeQuarterPtGrid=all(r[k]/.75 == round(r[k]/.75)
            for r in rows for k in ['rangePageXPt','rangePageYPt'] if r[k] != -1), rows=rows)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = analyze()
    if args.output: args.output.write_bytes((json.dumps(result,indent=2)+'\n').encode())
    print(json.dumps({k:v for k,v in result.items() if k!='rows'}))
