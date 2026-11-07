"""Independent native holdout for proposed WML theme rounding stages.

This diagnostic does not select renderer rules or fit any source-color lookup.
"""
import json
from check_theme_chroma_stages import ROOT, SETS, load_rows
from check_theme_relative_lightness import light_models, fixed_saturation, bias_free_saturation

SOURCE = 'theme-minmax-neighbors-20261004.docx'
DIRECTORY = ROOT/'tests/fixtures/theme-minmax-neighbors'


def evidence():
    rows = load_rows(DIRECTORY, SOURCE)
    native = json.loads((DIRECTORY/'reference.json').read_text())
    prior = {(c['base'], c['mode'], c['value']) for name in SETS
             for c, n in load_rows(ROOT/'tests/fixtures'/name)}
    overlap = sum((c['base'], c['mode'], c['value']) in prior for c, n in rows)
    return dict(scope='Independent authored native reference PDF holdout: six one-byte RGB neighbors of two parents. Hash-bound source/case/native files. Same diagnostic hypotheses as the original 2176-row study; no production conversion change or template promotion.',
                sourceFile=SOURCE, sourceSha256=native['sourceSha256'],
                casesSha256=native['casesSha256'], pdfSha256=native['pdfSha256'],
                nativePages=native['pages'], totalRows=len(rows),
                priorInputOverlap=overlap, newInputRows=len(rows)-overlap,
                newNeighborRows=sum(c['base'] not in ('4F81BD', 'C0504D') for c, n in rows),
                lightModels=light_models(rows), fixedSaturation=fixed_saturation(rows),
                arbitraryRoundingBias=bias_free_saturation(rows))


if __name__ == '__main__':
    result = evidence()
    (ROOT/'docs/evidence/theme-minmax-neighbors-2026-10-04.json').write_text(json.dumps(result, indent=2)+'\n')
    print('Holdout rows:', result['totalRows'], 'new neighbors:', result['newNeighborRows'])
    print('Light-model rejections:', [r['rejected'] for r in result['lightModels']])
    print('Rejected sources, fixed S / fixed S and bias:', result['fixedSaturation']['rejectedSources'], result['arbitraryRoundingBias']['rejectedSources'])
