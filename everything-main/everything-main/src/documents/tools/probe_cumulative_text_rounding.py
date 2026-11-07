"""Reject or retain global origin-rounding hypotheses against owned controls.

Reads recorded numeric origins only. Never accesses fonts, the reference application or a browser,
changes renderer tolerances, or overwrites a report. Results describe the retained
capture revision, not a fresh rendering or native-font equivalence check.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/calibri-native-advances'
STEP_PT = 72 / 600


def probe():
    reference = FIXTURE / 'native-page-pdf-origins.json'
    reference_bytes = reference.read_bytes()
    data = json.loads(reference_bytes)
    variants = {}
    models = {'nearest': lambda x: math.floor(x + .5),
              'floor': math.floor, 'ceil': math.ceil}
    for variant in ['default', 'openType']:
        capture = data[variant]['capture']
        source = (FIXTURE / variant / 'control.docx').read_bytes()
        assert hashlib.sha256(source).hexdigest() == capture['sourceSha256']
        assert capture['sourceUnchanged'] and capture['savedBefore'] and capture['savedAfter']
        assert capture['viewBefore'] == capture['viewAfter']
        assert capture['zoomBefore'] == capture['zoomAfter']
        assert data[variant]['paint']['traceCanvasDifferences'] == [0]
        assert data[variant]['paint']['opaqueFontGuardVerified']
        rows = data[variant]['rows']
        assert len(rows) == 20
        results = {}
        for name, quantize in models.items():
            cases = []
            for row in rows:
                native, canvas = row['nativePageXPt'], row['canvasXPt']
                assert 0 < len(native) == len(canvas) <= 1024
                assert all(math.isfinite(x) for x in native + canvas)
                origin = canvas[0]
                candidate = [origin + quantize((x - origin) / STEP_PT) * STEP_PT for x in canvas]
                before = [abs(x-y) for x, y in zip(canvas, native, strict=True)]
                after = [abs(x-y) for x, y in zip(candidate, native, strict=True)]
                delta = [a-b for a, b in zip(after, before)]
                improved = sum(d < -1e-9 for d in delta)
                worsened = sum(d > 1e-9 for d in delta)
                worst = max(range(len(after)), key=after.__getitem__)
                cases.append(dict(index=row['case']['index'], text=row['case']['text'],
                    characters=len(native), exactOrigins=sum(e < 1e-9 for e in after),
                    improved=improved, worsened=worsened, unchanged=len(delta)-improved-worsened,
                    beforeMaxPt=max(before), afterMaxPt=max(after),
                    worstOrigin=dict(index=worst, nativePt=native[worst], canvasPt=canvas[worst],
                                     candidatePt=candidate[worst])))
            results[name] = dict(
                **{key: sum(c[key] for c in cases) for key in
                   ['characters', 'exactOrigins', 'improved', 'worsened', 'unchanged']},
                maxErrorPt=max(c['afterMaxPt'] for c in cases), cases=cases)
        variants[variant] = results
    assert variants['default'] == variants['openType']
    return dict(scope='Numeric retained-origin diagnostic; no runtime or font access. '
                      'Not fresh rendering, glyph ink or native-font equivalence evidence.',
        referenceSha256=hashlib.sha256(reference_bytes).hexdigest(),
        referenceEngineRevision=data['engineRevision'], deviceStepPt=STEP_PT,
        baselineMaxErrorPt=data['defaultMaximumPageDifferencePt'],
        sameBothVariants=True, models=variants['default'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Use a fresh output; existing source and evidence are never overwritten.')
    result = probe()
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print(json.dumps({name: {k: v for k, v in model.items() if k != 'cases'}
                      for name, model in result['models'].items()}))
