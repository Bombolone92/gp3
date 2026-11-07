"""Reject insufficient shadow-channel pipelines using exact rational bounds.

Compatibility with a model is necessary, not sufficient, for matching the native reference.
This does not fit a blur kernel or produce rendered pixels. Exit 1 means every
candidate remains contradicted by native pixels; never use it as a match pass.
"""
from pathlib import Path
from fractions import Fraction as F
from functools import lru_cache
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'tests/fixtures/shadow-alpha-pipeline'
MODELS = ('rounded-source-single-pass', 'float-channel-single-pass', 'float-channel-two-pass')


def nearest(value):
    return (2 * value.numerator + value.denominator) // (2 * value.denominator)


def interval(values, amplitudes):
    """One common attenuation in [0,1], then round each channel to nearest."""
    low, high, inclusive = F(0), F(1), True
    for value, amplitude in zip(values, amplitudes):
        if not amplitude:
            if value:
                return None
            continue
        low = max(low, (F(value) - F(1, 2)) / amplitude)
        upper = (F(value) + F(1, 2)) / amplitude
        if upper <= high:
            high, inclusive = upper, False
    return (low, high, inclusive) if low < high or low == high and inclusive else None


@lru_cache(None)
def intermediate_states(amplitudes):
    """Enumerate every possible byte vector after a first rounded pass."""
    boundaries = {F(0), F(1)}
    for a in amplitudes:
        if a:
            boundaries.update(F(2 * i + 1, 2) / a for i in range(int(a) + 1) if F(2 * i + 1, 2) < a)
    ordered = sorted(boundaries)
    vectors = {tuple(nearest(a * (left + right) / 2) for a in amplitudes)
               for left, right in zip(ordered, ordered[1:])}
    vectors.add(tuple(nearest(a) for a in amplitudes))
    return sorted(vectors)


def premultiplied(rgba):
    alpha = rgba[3]
    reciprocal = 255 * 65536 // alpha
    result = []
    for channel in rgba[:3]:
        possible = [p for p in range(alpha + 1) if p * reciprocal // 65536 == channel]
        if len(possible) != 1:
            raise ValueError(f'Native pixel does not have a unique inverse under the 16-bit model: {rgba}')
        result.append(possible[0])
    return tuple(result + [alpha])


def audit():
    reference_path = FIXTURES / 'reference.json'
    reference = json.loads(reference_path.read_text())
    for name, expected in reference['hashes'].items():
        actual = hashlib.sha256((FIXTURES / name).read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError(f'Changed native evidence: {name}')
    cases = []
    for case in reference['cases']:
        alpha = F(nearest(F(case['sourceAlpha'] * case['alpha'], 100000)))
        colors = [int(case['color'][i:i + 2], 16) for i in (0, 2, 4)]
        floats = tuple([F(c) * alpha / 255 for c in colors] + [alpha])
        rounded = tuple(F(nearest(v)) for v in floats)
        candidates = intermediate_states(floats)
        counts = dict.fromkeys(MODELS, 0)
        witnesses = {}
        nonzero = 0
        for entry in case['images'][0]['histogram']:
            rgba = entry['rgba']
            if not rgba[3]:
                continue
            nonzero += entry['count']
            values = premultiplied(rgba)
            compatible = (interval(values, rounded), interval(values, floats),
                          any(interval(values, state) for state in candidates))
            for name, possible in zip(MODELS, compatible):
                if not possible:
                    counts[name] += entry['count']
                    witnesses.setdefault(name, dict(rgba=rgba, premultiplied=list(values), occurrences=entry['count']))
        cases.append(dict(name=case['name'], nonzeroPixels=nonzero,
                          roundedAmplitudes=list(map(int, rounded)),
                          floatAmplitudes=list(map(str, floats)),
                          incompatiblePixels=counts, firstWitness=witnesses))
    totals = {m: dict(incompatibleCases=sum(c['incompatiblePixels'][m] > 0 for c in cases),
                      incompatiblePixels=sum(c['incompatiblePixels'][m] for c in cases)) for m in MODELS}
    return dict(scope='Necessary-condition tests only; no kernel fit, rendered prediction or native-match claim.',
                nativeSource='tests/fixtures/shadow-alpha-pipeline/reference.json',
                nativeReferenceSha256=hashlib.sha256(reference_path.read_bytes()).hexdigest(),
                assumptions=['Constant rectangular silhouette; common nonnegative normalized linear filter per pass.',
                             'Round-half-up byte channels at stated boundaries; truncated 16-bit reciprocal output conversion.',
                             'Two-pass candidate is horizontal then vertical with one byte intermediate, not repeated box filtering.'],
                totals=totals, cases=cases)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = audit()
    if args.output:
        args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    for model, result in report['totals'].items():
        print(model, result)
    raise SystemExit(1 if all(v['incompatiblePixels'] for v in report['totals'].values()) else 0)
