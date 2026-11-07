"""Independent API controls for translation and fixed-point operation order.

The source curves are original authored controls, never corpus artwork. This
probe changes no renderer and makes no native DOCX pixel-match claim.
"""
from pathlib import Path
import argparse, gzip, hashlib, json
import numpy as np
from probe_svg_cubic_arithmetic import candidate
from probe_svg_cubic_flatten import quantized_input

ROOT = Path(__file__).resolve().parents[1]
SHIFTS = [(0, 0), (128, 0), (0, 128), (512, 512), (-512, -512),
          (4096, 4096), (65536, 65536)]
FAMILIES = ['svg-cubic-flatten-sweep', 'svg-cubic-terminal-rounding']
NATIVE_FILES = dict(zip(FAMILIES, ['native-quantized.json', 'native-api.json']))
sha = lambda b: hashlib.sha256(b).hexdigest()


def inputs():
    cases, sources = [], {}
    for family in FAMILIES:
        path = ROOT / 'tests/fixtures' / family / 'cases.json'
        data = path.read_bytes()
        sources[path.relative_to(ROOT).as_posix()] = sha(data)
        native_path = path.with_name(NATIVE_FILES[family])
        sources[native_path.relative_to(ROOT).as_posix()] = sha(native_path.read_bytes())
        for case in json.loads(data):
            points = quantized_input(case['points'])
            for shift in SHIFTS:
                cases.append(dict(name=f'{family}/{case["name"]}/{shift[0]},{shift[1]}',
                                  family=family, base=case['name'], shift=list(shift),
                                  points=(points + shift).tolist()))
    return cases, sources


def divided_terms(points, order):
    p = (points * 262144).astype(np.int64)
    position, delta = p[0].copy(), p[3] - p[0]
    e2, e3 = 3 * (p[0] - 2*p[1] + p[2]), 3 * (p[1] - 2*p[2] + p[3])
    t, step, out = 0., 1., [p[0] / 262144]
    error = lambda a, b: max(np.max(abs(a)), np.max(abs(b)))
    while t < 1:
        while error(e2, e3) > 196608:
            # Test smaller intermediate magnitudes by dividing before summing.
            e3 = (e2 // order + e3 // order) // (8 // order)
            delta, e2 = delta // 2 - e3, e2 // 4
            step /= 2
            if step < 1/65536:
                raise ValueError('Subdivision bound exceeded')
        while step < 1 and t % (2*step) == 0 and t + 2*step <= 1:
            next2, next3 = 4*e2, 8*e3 - 4*e2
            if error(next2, next3) > 196608:
                break
            delta, e2, e3 = 2*delta + 2*e3, next2, next3
            step *= 2
        position, delta = position + delta, delta + 2*e3
        e2, e3 = e3, 2*e3 - e2
        t += step
        out.append(np.floor(position/16384 + .5)/16)
    return np.array(out)


def generate(out):
    out.mkdir(parents=True, exist_ok=True)
    cases, _ = inputs()
    data = (json.dumps(cases, indent=2) + '\n').encode()
    (out / 'cases.json').write_bytes(data)
    return data


def record(out, native_path):
    data = generate(out)
    cases, sources = inputs()
    native_bytes = native_path.read_bytes()
    native = json.loads(native_bytes.decode('utf-8-sig'))
    assert native['inputSha256'] == sha(data)
    assert native['quantizeInput'] and native['tolerance'] == .25
    assert len(native['cases']) == len(cases) == 903
    base, changed, exact = {}, [], 0
    retained = {}
    for family in FAMILIES:
        path = ROOT / 'tests/fixtures' / family / NATIVE_FILES[family]
        retained[family] = {row['name']: row['points'] for row in
                            json.loads(path.read_text(encoding='utf-8-sig'))['cases']}
    for case, row in zip(cases, native['cases'], strict=True):
        assert case['name'] == row['name']
        vertices = np.array(row['points']).reshape(-1, 2)
        key = (case['family'], case['base'])
        translated = vertices - case['shift']
        if case['shift'] == [0, 0]:
            assert row['points'] == retained[case['family']][case['base']]
            base[key] = translated
        elif not np.array_equal(translated, base[key]):
            changed.append(case['name'])
        exact += np.array_equal(candidate(quantized_input(case['points'])), vertices)
    assert not changed
    order_rows = []
    for family in FAMILIES:
        pairs = [(c, n) for c, n in zip(cases, native['cases'], strict=True)
                 if c['family'] == family and c['shift'] == [0, 0]]
        for order in [1, 2, 4, 8]:
            matched = sum(np.array_equal(divided_terms(quantized_input(c['points']), order),
                                        np.array(n['points']).reshape(-1, 2)) for c, n in pairs)
            order_rows.append(dict(family=family, divideBeforeAdd=order,
                                   total=len(pairs), exact=int(matched)))
    # Retain exact capture/input bytes without repeating megabytes of whitespace.
    compressed = {}
    for name, content in [('cases.json', data), ('native-api.json', native_bytes)]:
        packed = gzip.compress(content, mtime=0)
        (out / (name + '.gz')).write_bytes(packed)
        compressed[name + '.gz'] = sha(packed)
    result = dict(scope='Native GDI+ API evidence, not native DOCX rendering proof.',
                  baseline='dd21ab85', inputSha256=sha(data), captureSha256=sha(native_bytes),
                  sources=sources, compressed=compressed, total=903,
                  changedTranslations=changed, currentExact=int(exact),
                  currentDifferent=903-int(exact), divisionOrder=order_rows)
    (out / 'reference.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--native', type=Path)
    args = parser.parse_args()
    if args.native:
        result = record(args.output, args.native)
        print(json.dumps({k: result[k] for k in ['total', 'changedTranslations', 'currentExact']}))
    else:
        print('Generated 903 independent translated curves:', sha(generate(args.output)))
