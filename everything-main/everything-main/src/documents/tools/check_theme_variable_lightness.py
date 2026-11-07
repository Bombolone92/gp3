"""Exact native constraints with arbitrary transformed lightness.

Rejects fixed saturation + one final floor/nearest encoding in dark HSL.
This is evidence about an unresolved renderer, not a rendering certification.
"""
from fractions import Fraction
from hashlib import sha256
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

def saturation_bounds(rgb, bias=Fraction(0)):
    """Necessary open interval, allowing any lightness for this output.

    max=floor(L*(1+S)+bias), min=floor(L*(1-S)+bias).
    Positive denominator and the dark-branch precondition are checked here.
    """
    high, low = max(rgb), min(rgb)
    denominator = high + low + 1 - 2 * bias
    if denominator <= 0 or high + low + 2 - 2 * bias >= 255:
        return None
    # A zero minimum permits S=1. The upper bound obtained by dividing by
    # 1-S is then inapplicable; 2 is nonrestrictive within the HSL [0,1] domain.
    return (Fraction(high - low - 1, denominator),
            Fraction(2) if low == 0 else Fraction(high + 1 - low, denominator))

def analyze(rows, bias):
    bounds = [(i, rgb, saturation_bounds(rgb, bias)) for i, rgb in enumerate(rows)]
    bounds = [(i, rgb, bound) for i, rgb, bound in bounds if bound is not None]
    lower = max(bounds, key=lambda row: row[2][0])
    upper = min(bounds, key=lambda row: row[2][1])
    return dict(rejected=lower[2][0] >= upper[2][1],
                lower=dict(modifier=lower[0], rgb=lower[1], bound=str(lower[2][0])),
                upper=dict(modifier=upper[0], rgb=upper[1], bound=str(upper[2][1])))

def evidence():
    folder = ROOT / 'tests/fixtures/theme-shade-sweep'
    reference = json.loads((folder / 'reference.json').read_text())
    for name, key in [('control.docx', 'sourceSha256'), ('cases.json', 'casesSha256'), ('native.pdf', 'pdfSha256')]:
        if sha256((folder / name).read_bytes()).hexdigest() != reference[key]:
            raise ValueError('Native reference hash mismatch: ' + name)
    cases = json.loads((folder / 'cases.json').read_text())
    if len(cases) != 512 or len(reference['colors']) != 512:
        raise ValueError('Expected the complete paired shade sweeps')
    groups = {}
    for i, case in enumerate(cases):
        row = reference['colors'][i]
        if case['label'] != row['label'] or case['mode'] != 'shade':
            raise ValueError('Native case order mismatch')
        groups.setdefault(case['base'], []).append((case['value'], row['rgb']))
    results = {}
    for base, rows in groups.items():
        if [value for value, _ in rows] != list(range(256)):
            raise ValueError('Incomplete shade-byte coverage')
        rgb = [rgb for _, rgb in rows]
        results[base] = {'floor': analyze(rgb, Fraction(0)), 'nearest': analyze(rgb, Fraction(1, 2))}
    return dict(scope='Necessary dark-HSL extrema constraints; arbitrary lightness per modifier, fixed saturation per base, one final floor or nearest encoding. Not a renderer pass.',
                sourceSha256=reference['sourceSha256'], casesSha256=reference['casesSha256'], pdfSha256=reference['pdfSha256'], results=results)

if __name__ == '__main__':
    print(json.dumps(evidence(), indent=2))
