"""Bound fixed-precision explanations of native curves; never select runtime rules.

An empty precision set rejects every tested precision for that complete curve.
Axis sets share the full two-dimensional adaptive step schedule. They are not
independent one-dimensional flattening models. API contours are separate from
native DOCX raster references, which require the browser comparison tool.
"""
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np
from probe_svg_cubic_arithmetic import candidate
from probe_svg_cubic_flatten import quantized_input

ROOT = Path(__file__).resolve().parents[1]
FAMILIES = ['svg-cubic-flatten-sweep', 'svg-cubic-terminal-rounding', 'svg-cubic-step-changes']


def probe():
    families = []
    for family in FAMILIES:
        folder = ROOT / 'tests/fixtures' / family
        filename = 'native-quantized.json' if family.endswith('sweep') else 'native-api.json'
        source, captured = (folder/'cases.json').read_bytes(), (folder/filename).read_bytes()
        cases, native = json.loads(source), json.loads(captured.decode('utf-8-sig'))
        assert native['inputSha256'] == hashlib.sha256(source).hexdigest()
        assert native['quantizeInput'] and native['tolerance'] == .25
        rows = []
        for case, reference in zip(cases, native['cases'], strict=True):
            assert case['name'] == reference['name']
            expected = np.array(reference['points']).reshape(-1, 2)
            exact, axes, errors, same_counts = [], [[], []], [], []
            for precision in range(23):
                try:
                    actual = candidate(quantized_input(case['points']), precision=precision)
                except ValueError:
                    errors.append(precision)
                    continue
                if actual.shape != expected.shape:
                    continue
                same_counts.append(precision)
                if np.array_equal(actual, expected):
                    exact.append(precision)
                for axis in range(2):
                    if np.array_equal(actual[:, axis], expected[:, axis]):
                        axes[axis].append(precision)
            rows.append(dict(case=case['name'], exactPrecisions=exact, axisPrecisions=axes,
                             matchingVertexCounts=same_counts, subdivisionBoundErrors=errors))
        families.append(dict(family=family, total=len(rows),
                             currentExact=sum(14 in r['exactPrecisions'] for r in rows),
                             noTestedPrecision=sum(not r['exactPrecisions'] for r in rows),
                             noAxisCombination=sum(not all(r['axisPrecisions']) for r in rows),
                             referenceHashes={'cases.json': hashlib.sha256(source).hexdigest(),
                                              filename: hashlib.sha256(captured).hexdigest()}, rows=rows))
    folder = ROOT/'tests/fixtures/svg-cubic-step-changes'
    cases = json.loads((folder/'cases.json').read_bytes())
    references = json.loads((folder/'native-api.json').read_text(encoding='utf-8-sig'))['cases']
    case = next(c for c in cases if c['name'] == 's-64-127')
    reference = next(r for r in references if r['name'] == case['name'])
    t, index = 55/64, 33
    points = np.array(case['points'], dtype=float)
    # Independent Bernstein evaluation at this observed dyadic step. Equality
    # proves the diagnostic's intermediate point has no arithmetic drift here;
    # it does not prove the reference must use this point or this rounding convention.
    analytic = ((1-t)**3*points[0] + 3*(1-t)**2*t*points[1] +
                3*(1-t)*t*t*points[2] + t**3*points[3])
    intermediate = candidate(points, unrounded=True)[index]
    assert np.array_equal(intermediate, analytic)
    witness = dict(case=case['name'], vertexIndex=index, t=t, analyticPoint=analytic.tolist(),
                   diagnosticIntermediate=intermediate.tolist(),
                   diagnosticRounded=candidate(points)[index].tolist(),
                   nativePoint=np.array(reference['points']).reshape(-1, 2)[index].tolist())
    return dict(scope=__doc__, testedPrecisions=list(range(23)), families=families,
                analyticWitness=witness)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = probe()
    args.output.write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    for family in result['families']:
        print(f"{family['family']}: {family['currentExact']}/{family['total']} current exact; "
              f"{family['noTestedPrecision']} have no exact precision in 0..22")
