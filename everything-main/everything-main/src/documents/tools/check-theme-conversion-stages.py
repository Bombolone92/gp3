"""Original diagnostic for rejected theme-color conversion hypotheses.

Run with one of: channels, bounds, amount. Results are match counts against
native references, not conformance passes. No renderer code is imported.
"""
import argparse
import colorsys
import itertools
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures'
OPTIONS = [(0, 'none')] + list(itertools.product([240, 255, 256], ['floor', 'round']))


def quantize(value, option):
    scale, mode = option
    return value if not scale else math.floor(value * scale + (0.5 if mode == 'round' else 1e-9)) / scale


def encode(values, scale=255, rounding='floor'):
    return [max(0, min(255, math.floor(v * scale + (0.5 if rounding == 'round' else 1e-9)))) for v in values]


def read_cases():
    rows = []
    for name, count in [('theme-shade-sweep', 512), ('theme-color-precision', 128),
                        ('theme-color-boundaries', 128), ('theme-color-complements', 128)]:
        directory = ROOT / name
        cases = json.loads((directory / 'cases.json').read_text())
        saved = directory / 'native-saved-colors.json'
        reference = json.loads((saved if saved.exists() else directory / 'reference.json').read_text())
        colors = [list(bytes.fromhex(v['attributes']['val'])) for v in reference] if saved.exists() else [v['rgb'] for v in reference['colors']]
        if len(cases) != count or len(colors) != count:
            raise ValueError(f'Incomplete native reference: {name}')
        rows.extend((list(bytes.fromhex(c['base'])), c['mode'], c['value'], rgb) for c, rgb in zip(cases, colors))
    return rows


def candidates(stage):
    if stage == 'channels':
        for incoming, outgoing, hue, saturation, rounding, identity in itertools.product([255, 256], [255, 256], OPTIONS, OPTIONS, ['floor', 'round'], [False, True]):
            yield dict(input=incoming, output=outgoing, hue=hue, saturation=saturation, rounding=rounding, identity=identity)
    elif stage == 'bounds':
        bounds = [(0, 'none')] + list(itertools.product([255, 256, 65536], ['floor', 'round']))
        for hue, saturation, lower, upper in itertools.product(OPTIONS, OPTIONS, bounds, bounds):
            yield dict(hue=hue, saturation=saturation, lower=lower, upper=upper)
    else:
        amounts = [(0, 'none')] + list(itertools.product([100, 1000, 10000, 100000, 256, 65536], ['floor', 'round']))
        for hue, saturation, amount, rounding in itertools.product(OPTIONS, OPTIONS, amounts, ['floor', 'round']):
            yield dict(hue=hue, saturation=saturation, amount=amount, rounding=rounding)


def convert(rgb, mode, value, candidate, stage):
    if candidate.get('identity', True) and value == 255:
        return rgb
    h, light, saturation = colorsys.rgb_to_hls(*[v / candidate.get('input', 255) for v in rgb])
    h, saturation = quantize(h, candidate['hue']), quantize(saturation, candidate['saturation'])
    amount = quantize(value / 255, candidate.get('amount', (0, 'none')))
    light = light * amount if mode == 'shade' else light * amount + 1 - amount
    if stage != 'bounds':
        return encode(colorsys.hls_to_rgb(h, light, saturation), candidate.get('output', 255), candidate.get('rounding', 'floor'))
    upper = light * (1 + saturation) if light <= .5 else light + saturation - light * saturation
    lower = quantize(2 * light - upper, candidate['lower'])
    upper = quantize(upper, candidate['upper'])

    def channel(hue):
        hue %= 1
        if hue < 1 / 6:
            return lower + (upper - lower) * hue * 6
        if hue < .5:
            return upper
        if hue < 2 / 3:
            return lower + (upper - lower) * (2 / 3 - hue) * 6
        return lower

    return encode([channel(h + 1 / 3), channel(h), channel(h - 1 / 3)])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['channels', 'bounds', 'amount'])
    stage = parser.parse_args().stage
    rows = read_cases()
    results = [dict(candidate, matched=sum(convert(rgb, mode, value, candidate, stage) == native for rgb, mode, value, native in rows)) for candidate in candidates(stage)]
    results.sort(key=lambda value: -value['matched'])
    print(json.dumps(dict(stage=stage, cases=len(rows), candidates=len(results), best=results[:8]), indent=2))
