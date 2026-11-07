"""Compare original arithmetic hypotheses with hash-bound native cubic controls.

This diagnostic never changes the renderer. The 113-case sweep is a GDI+ API
reference; only the six larger controls also have independently captured native
DOCX raster references. Matching vertices alone does not establish a pixel match.
"""
from pathlib import Path
import argparse
import hashlib
import itertools
import json
import numpy as np
from probe_svg_cubic_flatten import finite_difference, quantized_input


def candidate(points, precision=14, rounding='up', division=('floor',)*3, storage='integer', unrounded=False, initial_strict=False, coarsen_strict=False, error_units=12, half_delta='separate'):
    if half_delta not in ('separate', 'exact-floor', 'exact-truncate', 'quarter-floor', 'quarter-truncate', 'nearest'):
        raise ValueError('Unknown half-delta model')
    if not np.isfinite(error_units) or error_units <= 0:
        raise ValueError('Invalid error bound')
    dtype = np.float32 if storage == 'float32' else np.int64
    p = (points*16*2**precision).astype(dtype)
    position, delta = p[0].copy(), p[3]-p[0]
    e2, e3 = 3*(p[0]-2*p[1]+p[2]), 3*(p[1]-2*p[2]+p[3])
    result, t, step = [position.copy()], 0., 1.
    threshold = error_units*2**precision
    error = lambda a, b: max(np.max(abs(a)), np.max(abs(b)))

    def divide(value, denominator, mode):
        operation = {'floor': np.floor, 'truncate': np.trunc,
                     'nearest': lambda x: np.floor(x+.5)}[mode]
        return operation(value/denominator).astype(dtype)

    while t < 1:
        while error(e2, e3) > threshold or initial_strict and error(e2, e3) == threshold:
            old_sum = e2+e3
            e3 = divide(old_sum, 8, division[0])
            if half_delta == 'separate':
                delta = divide(delta, 2, division[1])-e3
            elif half_delta.startswith('quarter-'):
                delta = divide(delta-divide(old_sum, 4, half_delta[8:]), 2, 'floor')
            else:
                mode = half_delta[6:] if half_delta.startswith('exact-') else 'nearest'
                delta = divide(4*delta-old_sum, 8, mode)
            e2 = divide(e2, 4, division[2])
            step /= 2
            if step < 2**-16:
                raise ValueError('Subdivision bound exceeded')
        while step < 1 and t % (2*step) == 0 and t+2*step <= 1:
            next2, next3 = 4*e2, 8*e3-4*e2
            if error(next2, next3) > threshold or coarsen_strict and error(next2, next3) == threshold:
                break
            delta, e2, e3 = 2*delta+2*e3, next2, next3
            step *= 2
        position = position+delta
        delta = delta+2*e3
        e2, e3 = e3, 2*e3-e2
        t += step
        result.append(position.copy())
    values = np.array(result)/2**precision
    if unrounded:
        return values/16
    rounds = {'up': lambda x: np.floor(x+.5), 'down': lambda x: np.ceil(x-.5),
              'even': np.round, 'away': lambda x: np.sign(x)*np.floor(abs(x)+.5)}
    return rounds[rounding](values)/16


def probe():
    root = Path(__file__).resolve().parents[1]/'tests/fixtures'
    sweep, large = root/'svg-cubic-flatten-sweep', root/'svg-cubic-coverage-large'
    read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    cases, native = read(sweep/'cases.json'), read(sweep/'native-quantized.json')
    assert sha(sweep/'cases.json') == native['inputSha256']
    larger, word = read(large/'cases.json'), read(large/'native-coverage-reference.json')
    assert sha(large/'cases.json') == word['casesSha256']
    manifest = read(large/'metafile-reference.json')
    assert sha(large/'control.docx') == manifest['sourceSha256'] == word['sourceSha256']
    for image, row in zip(manifest['images'], word['rows'], strict=True):
        assert sha(large/image['path']) == image['sha256'] == row['nativeSha256']
    configs = ([dict(precision=p) for p in range(10,23)] +
               [dict(rounding=r) for r in ['up','down','even','away']] +
               [dict(division=m) for m in itertools.product(['floor','truncate','nearest'],repeat=3)] +
               [dict(storage='float32')])
    results = []
    for config in configs:
        matches = []
        for case, row in zip(cases, native['cases'], strict=True):
            assert case['name'] == row['name']
            actual = candidate(quantized_input(case['points']), **config)
            matches.append(bool(np.array_equal(actual, np.array(row['points']).reshape(-1,2))))
            if not config or config == {'precision':14}:
                assert np.array_equal(actual, finite_difference(quantized_input(case['points'])))
        controls = []
        for case, row in zip(larger, word['rows'], strict=True):
            actual = candidate(quantized_input(case['points']), **config)
            expected = np.array(row['flattened'][0]['coordinates']).reshape(-1,2)
            if len(expected) == len(actual)+1 and np.array_equal(expected[-1],expected[0]):
                expected = expected[:-1]
            same = actual.shape == expected.shape
            controls.append(dict(case=case['name'], exact=bool(np.array_equal(actual,expected)),
                                 changedCoordinates=int(np.count_nonzero(actual!=expected)) if same else None,
                                 maximumCoordinateError=float(abs(actual-expected).max()) if same else None))
        results.append(dict(config=config, apiExact=sum(matches), apiTotal=len(matches), nativeControls=controls))
    return dict(scope=__doc__, referenceHashes={str(p.relative_to(root)):sha(p) for p in
                [sweep/'cases.json',sweep/'native-quantized.json',large/'cases.json',
                 large/'native-coverage-reference.json',large/'metafile-reference.json']}, results=results)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    args = parser.parse_args()
    result = probe()
    args.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(f"{len(result['results'])} models; best API score {max(r['apiExact'] for r in result['results'])}/113; no renderer change")
