"""Exact-arithmetic diagnostic; not a production color conversion.

Test whether flooring chroma and the relative-channel contribution to thirds
of a byte explains the native colors. Passing near-gray controls alone is not
evidence of a generally valid conversion. All references are hash-bound.
"""
from fractions import Fraction as F
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
SETS = ['theme-low-chroma-sweep', 'theme-shade-sweep',
        'theme-color-boundaries', 'theme-color-complements',
        'theme-channel-extrema', 'theme-permutations', 'theme-color-precision',
        'theme-chroma-midtones']


def load_rows(directory, source='control.docx'):
    cases = json.loads((directory / 'cases.json').read_text())
    if directory.name == 'theme-color-precision':
        manifest = json.loads((directory / 'manifest.json').read_text())
        bindings = [(ROOT / 'public/fixtures' / name if name.endswith('.docx')
                     else directory / name, digest)
                    for name, digest in manifest['sha256'].items()]
        colors = json.loads((directory / 'native-saved-colors.json').read_text())
        reference = [dict(label=r['label'], rgb=list(bytes.fromhex(r['attributes']['val'])))
                     for r in colors]
    else:
        data = json.loads((directory / 'reference.json').read_text())
        bindings = [(directory / filename, data[key]) for filename, key in
                    [(source, 'sourceSha256'), ('cases.json', 'casesSha256'),
                     ('native.pdf', 'pdfSha256')]]
        reference = data['colors']
        if directory.name == 'theme-chroma-midtones':
            manifest = json.loads((directory / 'manifest.json').read_text())
            bindings += [(directory / filename, digest) for filename, digest in manifest.items()]
            saved = json.loads((directory / 'native-saved-colors.json').read_text())
            capture = json.loads((directory / 'native-capture.json').read_text(encoding='utf-8-sig'))
            if not capture['sourceUnchanged'] or any(capture[k] != data[k]
                    for k in ('sourceSha256', 'pdfSha256')):
                raise ValueError('Native capture provenance mismatch')
            if saved['savedDocxSha256'] != capture['savedDocxSha256'] or saved['referenceBuild'] != capture['referenceBuild']:
                raise ValueError('Saved copy provenance mismatch')
            if [(r['label'], list(bytes.fromhex(r['attributes']['val']))) for r in saved['colors']] != [
                    (r['label'], r['rgb']) for r in reference]:
                raise ValueError('Native saved XML differs from PDF colors')
    for path, digest in bindings:
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('Reference hash mismatch: ' + str(path))
    if [c['label'] for c in cases] != [r['label'] for r in reference]:
        raise ValueError('Reference labels mismatch')
    return list(zip(cases, reference, strict=True))


def convert(base, mode, value, subdivisions=3):
    """Quantize C and C*relative separately, with exact rational arithmetic."""
    if mode not in ('shade', 'tint') or not 0 <= value <= 255 or subdivisions <= 0:
        raise ValueError('Invalid diagnostic arguments')
    rgb = list(bytes.fromhex(base))
    if len(rgb) != 3:
        raise ValueError('Expected RGB triplet')
    if value == 255:
        return rgb
    high, low = max(rgb), min(rgb)
    delta = high - low
    light = F(high + low, 510)
    amount = F(value, 255)
    light = light * amount if mode == 'shade' else light * amount + 1 - amount
    if not delta:
        return [int(light * 255)] * 3
    saturation = F(delta, high + low if high + low <= 255 else 510 - high - low)
    chroma = F(int((1 - abs(2 * light - 1)) * saturation * 255 * subdivisions), subdivisions)
    minimum = light * 255 - chroma / 2
    return [int(minimum + F(int(chroma * F(channel - low, delta) * subdivisions), subdivisions))
            for channel in rgb]


def evidence():
    result = []
    for name in SETS:
        rows = load_rows(ROOT / 'tests/fixtures' / name)
        models = []
        for subdivisions in [2, 3, 4]:
            failures = []
            for case, native in rows:
                actual = convert(case['base'], case['mode'], case['value'], subdivisions)
                if actual != native['rgb']:
                    failures.append(dict(case, actual=actual, native=native['rgb']))
            models.append(dict(subdivisions=subdivisions, matches=len(rows)-len(failures),
                               failures=len(failures), firstFailure=failures[0] if failures else None))
        result.append(dict(set=name, cases=len(rows), models=models))
    return dict(scope='Exact rational arithmetic, diagnostic only; no renderer rule.',
                totalCases=sum(r['cases'] for r in result), results=result)


if __name__ == '__main__':
    print(json.dumps(evidence(), indent=2))
