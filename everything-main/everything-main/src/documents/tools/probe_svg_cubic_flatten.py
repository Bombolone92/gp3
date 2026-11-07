"""Unreleased cubic-flattening hypotheses; native differences exit with status 1.

Neither model is used by the renderer. Both are original mathematical probes.
The finite-difference precision is an experimental parameter, not a proven rule.
"""
from pathlib import Path
from hashlib import sha256
import argparse
import json
import numpy as np


def quantized_input(points):
    return np.ceil(np.array(points, dtype=np.float32).astype(float) * 16) / 16


def subdivide(points):
    result = [points[0]]

    def visit(p, depth=0):
        error = max(np.max(abs(p[0] - 2*p[1] + p[2])), np.max(abs(p[1] - 2*p[2] + p[3])))
        if error <= .25:
            result.append(np.floor(p[3]*16 + .5) / 16)
            return
        if depth >= 16:
            raise ValueError('Diagnostic subdivision limit exceeded')
        a, b, c = (p[0]+p[1])/2, (p[1]+p[2])/2, (p[2]+p[3])/2
        d, e = (a+b)/2, (b+c)/2
        f = (d+e)/2
        visit(np.array([p[0], a, d, f]), depth+1)
        visit(np.array([f, e, c, p[3]]), depth+1)

    visit(points)
    return np.array(result)


def finite_difference(points, precision=14):
    # e2/e3 are three times the endpoint second differences of the current
    # cubic segment. Midpoint splitting changes these by powers of two.
    p = (points * 16 * (2**precision)).astype(np.int64)
    position = p[0].copy()
    delta = p[3] - p[0]
    e2, e3 = 3*(p[0]-2*p[1]+p[2]), 3*(p[1]-2*p[2]+p[3])
    t, step = 0., 1.
    result = [position.copy()]
    threshold = 12 * (2**precision)
    error = lambda a, b: max(np.max(abs(a)), np.max(abs(b)))
    while t < 1:
        while error(e2, e3) > threshold:
            e3 = (e2+e3)//8
            delta = delta//2-e3
            e2 //= 4
            step /= 2
            if step < 2**-16:
                raise ValueError('Diagnostic subdivision limit exceeded')
        while step < 1 and t % (2*step) == 0 and t+2*step <= 1:
            next_delta, next_e2, next_e3 = 2*delta+2*e3, 4*e2, 8*e3-4*e2
            if error(next_e2, next_e3) > threshold:
                break
            delta, e2, e3 = next_delta, next_e2, next_e3
            step *= 2
        position = position+delta
        delta = delta+2*e3
        e2, e3 = e3, 2*e3-e2
        t += step
        result.append(position.copy())
    return np.floor(np.array(result)/(2**precision)+.5)/16


def compare(actual, native):
    same_shape = actual.shape == native.shape
    return dict(exact=bool(np.array_equal(actual, native)), actualVertices=len(actual),
                nativeVertices=len(native), changedCoordinates=int(np.count_nonzero(actual != native)) if same_shape else None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1] / 'tests/fixtures'
    sweep = root / 'svg-cubic-flatten-sweep'
    source = (sweep / 'cases.json').read_bytes()
    cases = json.loads(source)
    references = [json.loads((sweep / name).read_text(encoding='utf-8-sig')) for name in ['native.json', 'native-quantized.json']]
    for reference in references:
        assert reference['inputSha256'] == sha256(source).hexdigest()
    results = []
    for case, raw, quantized in zip(cases, references[0]['cases'], references[1]['cases'], strict=True):
        assert case['name'] == raw['name'] == quantized['name']
        points = quantized_input(case['points'])
        for name, model in [('subdivide', subdivide), ('finite-difference-14', finite_difference)]:
            actual = model(points)
            for label, reference in [('raw', raw), ('quantized', quantized)]:
                results.append(dict(case=case['name'], model=name, reference=label,
                                    **compare(actual, np.array(reference['points']).reshape(-1, 2))))
    controls = root / 'svg-cubic-coverage'
    controls_source = (controls / 'cases.json').read_bytes()
    native = json.loads((controls / 'native-coverage-reference.json').read_text())
    assert sha256(controls_source).hexdigest() == native['casesSha256']
    for i, (case, reference) in enumerate(zip(json.loads(controls_source), native['rows'], strict=True)):
        x, y = 2+20*i, 10
        a, b, c, d = case['controls']
        points = quantized_input([[x,y], [x+a,y+b], [x+c,y+d], [x+16,y]])
        expected = np.array(reference['flattened'][0]['coordinates']).reshape(-1, 2)[:-2]
        for name, model in [('subdivide', subdivide), ('finite-difference-14', finite_difference)]:
            results.append(dict(case=case['name'], model=name, reference='native-control', **compare(model(points), expected)))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2) + '\n')
    for name in ['subdivide', 'finite-difference-14']:
        for reference in ['native-control', 'raw', 'quantized']:
            selected = [r for r in results if r['model'] == name and r['reference'] == reference]
            print(f'{name} {reference}: {sum(r["exact"] for r in selected)}/{len(selected)} exact')
    return 1 if any(not r['exact'] for r in results) else 0


if __name__ == '__main__':
    raise SystemExit(main())
