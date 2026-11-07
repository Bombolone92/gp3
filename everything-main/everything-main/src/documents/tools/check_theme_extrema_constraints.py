"""Exact native counterexamples to fixed-saturation HSL plus final truncation.

This is a rejected-model proof, not a renderer or a rendering pass. For dark
output, q=L*(1+S), p=L*(1-S), where L is in channel units. An observed integer
maximum q0 under final floor requires q0 <= L*(1+S) < q0+1. Intersecting those
intervals for one base must admit a single S if that hypothesis is valid.
"""
import hashlib
import json
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def counterexamples(directory):
    cases = json.loads((directory / 'cases.json').read_text())
    native = json.loads((directory / 'reference.json').read_text())
    for name, key in [('control.docx', 'sourceSha256'), ('cases.json', 'casesSha256'), ('native.pdf', 'pdfSha256')]:
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != native[key]:
            raise ValueError('Native source hash mismatch: ' + name)
    if [r['label'] for r in native['colors']] != [c['label'] for c in cases]:
        raise ValueError('Native labels differ from source cases')
    result = []
    for base in dict.fromkeys(c['base'] for c in cases):
        channels = bytes.fromhex(base)
        if min(channels) == max(channels):
            continue
        intervals = []
        for case, observed in zip(cases, native['colors'], strict=True):
            if case['base'] != base or case['mode'] != 'shade' or case['value'] in (0, 255):
                continue
            light = Fraction((max(channels) + min(channels)) * case['value'], 510)
            if not 0 < light < Fraction(255, 2):
                continue
            maximum = max(observed['rgb'])
            intervals.append((Fraction(maximum, 1) / light - 1,
                              Fraction(maximum + 1, 1) / light - 1, case, observed, light))
        if not intervals:
            continue
        lower = max(intervals, key=lambda row: row[0])
        upper = min(intervals, key=lambda row: row[1])
        def witness(row, index):
            return dict(label=row[2]['label'], shade=row[2]['value'], rgb=row[3]['rgb'],
                        lightnessChannelUnits=str(row[4]), saturationBound=str(row[index]))
        result.append(dict(base=base, impossible=lower[0] >= upper[1],
                           lowerInclusive=witness(lower, 0), upperExclusive=witness(upper, 1)))
    return result


if __name__ == '__main__':
    result = counterexamples(ROOT / 'tests/fixtures/theme-shade-sweep')
    if len(result) != 2 or not all(r['impossible'] for r in result):
        raise SystemExit('Native evidence no longer establishes both contradictions')
    print(json.dumps(result, indent=2))
