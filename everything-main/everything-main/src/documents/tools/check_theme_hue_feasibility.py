"""Exact RGB-box feasibility for hue-preserving theme-color conversions.

Diagnostic only: arbitrary per-modifier lightness/saturation, uniform final
floor/nearest encoding. No renderer approximation or source-color lookup.
"""
from fractions import Fraction as F
from hashlib import sha256
from itertools import permutations
import json
from check_theme_chroma_stages import ROOT, SETS, load_rows


def clip(polygon, a, b, c):
    """Intersect a convex rational polygon with a*p+b*q <= c."""
    if not polygon:
        return []
    result = []
    previous = polygon[-1]
    old = a * previous[0] + b * previous[1] - c
    for point in polygon:
        new = a * point[0] + b * point[1] - c
        if (old <= 0) != (new <= 0):
            fraction = old / (old - new)
            result.append(tuple(previous[i] + fraction * (point[i] - previous[i]) for i in range(2)))
        if new <= 0:
            result.append(point)
        previous, old = point, new
    return list(dict.fromkeys(result))


def feasible(base, rgb, bias=F(0), exact_light=None):
    """Allow any continuous endpoints p<=q with the source hue.

    Each channel is (1-t)*p+t*q, t=(source-low)/(high-low). Final output
    bins are [native-bias, native+1-bias). A barycenter of the closed polygon
    proves feasibility iff it also lies strictly inside every open upper bound.
    """
    if bias not in (F(0), F(1, 2)) or not isinstance(rgb, (list, tuple)) or len(rgb) != 3 or any(type(n) is not int or not 0 <= n <= 255 for n in rgb):
        raise ValueError('Invalid encoding or native RGB')
    if exact_light is not None and (type(exact_light) not in (int, F) or not 0 <= exact_light <= 255):
        raise ValueError('Expected exact byte-scale lightness')
    if not isinstance(base, str) or len(base) != 6:
        raise ValueError('Expected RGB hex triplet')
    source = list(bytes.fromhex(base))
    if len(source) != 3:
        raise ValueError('Expected RGB hex triplet')
    low, high = min(source), max(source)
    ratios = [F(c-low, high-low) if high != low else F(0) for c in source]
    polygon = [(F(0), F(0)), (F(0), F(255)), (F(255), F(255))] if high != low else [(F(0), F(0)), (F(255), F(255))]
    if exact_light is not None:
        polygon = clip(clip(polygon, F(1), F(1), 2*exact_light), F(-1), F(-1), -2*exact_light)
    upper = []
    for t, native in zip(ratios, rgb, strict=True):
        a, b = 1-t, t
        polygon = clip(polygon, -a, -b, -(F(native)-bias))
        polygon = clip(polygon, a, b, F(native)+1-bias)
        upper.append((a, b, F(native)+1-bias))
    if not polygon:
        return dict(feasible=False, reason='Closed RGB boxes have no hue-preserving intersection')
    p, q = [sum(v[i] for v in polygon)/len(polygon) for i in range(2)]
    if any(a*p+b*q >= c for a, b, c in upper):
        return dict(feasible=False, reason='The only closed intersection lies on an excluded upper boundary')
    colors = [(1-t)*p+t*q for t in ratios]
    if [int(c+bias) for c in colors] != rgb:
        raise AssertionError('Rational witness does not reproduce native RGB')
    return dict(feasible=True, minimum=str(p), maximum=str(q), channels=[str(c) for c in colors])


def transformed_light(case):
    if type(case['value']) is not int or not 0 <= case['value'] <= 255:
        raise ValueError('Expected modifier byte')
    source = list(bytes.fromhex(case['base']))
    light = F(max(source)+min(source), 2)
    factor = F(case['value'], 255)
    if case['mode'] == 'shade':
        return light * factor
    if case['mode'] == 'tint':
        return light * factor + 255*(1-factor)
    raise ValueError('Unexpected modifier')


def fixed_hue_bounds(rows, order):
    """Necessary interval for ANY fixed hue in one of six RGB sectors.

    For low/high native bytes l/h and middle byte m, the encoded boxes
    require m-1 < l+t*(h-l) < m+1. All uniform floor/nearest offsets cancel.
    Boundary clipping at RGB 0/255 can impose additional restrictions, so a
    nonempty interval is explicitly inconclusive. An empty interval is proof.
    """
    if sorted(order) != [0, 1, 2]:
        raise ValueError('Expected a channel permutation')
    lower, upper = F(0), F(1)
    lower_open = upper_open = False
    lower_case = upper_case = None
    for case, native in rows:
        rgb = native['rgb']
        if len(rgb) != 3 or any(type(n) is not int or not 0 <= n <= 255 for n in rgb):
            raise ValueError('Invalid native RGB')
        low, middle, high = [rgb[i] for i in order]
        if not low <= middle <= high:
            return dict(rejected=True, reason='Native channel ordering excludes this hue sector',
                        orderingCounterexample=dict(case, native=rgb))
        if low == high:
            continue
        lo, hi = F(middle-low-1, high-low), F(middle-low+1, high-low)
        if lo >= lower:
            lower, lower_open, lower_case = lo, True, dict(case, native=rgb)
        if hi <= upper:
            upper, upper_open, upper_case = hi, True, dict(case, native=rgb)
    return dict(rejected=lower > upper or (lower == upper and (lower_open or upper_open)),
                lower=str(lower), upper=str(upper), lowerOpen=lower_open, upperOpen=upper_open,
                lowerCounterexample=lower_case, upperCounterexample=upper_case)


def fixed_hue_evidence(rows):
    rows = conversion_rows(rows)
    bases = sorted({case['base'] for case, _ in rows})
    result = []
    for base in bases:
        selected = [(case, native) for case, native in rows if case['base'] == base]
        sectors = [dict(order=list(order), **fixed_hue_bounds(selected, order))
                   for order in permutations(range(3))]
        result.append(dict(base=base, cases=len(selected), rejected=all(s['rejected'] for s in sectors),
                           sectors=sectors))
    return result


def conversion_rows(rows):
    """Neutral byte FF can bypass conversion; never constrain its hue grid.

    Authored controls include FF explicitly. Reference-saved copies can omit it.
    Check exact native identity before excluding these rows from initial-hue
    conversion hypotheses, rather than silently dropping a failed endpoint.
    """
    active = []
    for case, native in rows:
        if case.get('value') == 255:
            if native['rgb'] != list(bytes.fromhex(case['base'])):
                raise ValueError('Native neutral modifier is not source identity')
        else:
            active.append((case, native))
    return active


def hue_sector(base, scale=None, nearest=False):
    """Exact source RGB-to-hue, optionally quantized on a uniform turn grid."""
    r, g, b = bytes.fromhex(base)
    high, low = max(r, g, b), min(r, g, b)
    if high == low:
        return None
    delta = high-low
    sextant = F(g-b, delta) if high == r else 2+F(b-r, delta) if high == g else 4+F(r-g, delta)
    turn = (sextant/6) % 1
    if scale is not None:
        if type(scale) is not int or scale <= 0:
            raise ValueError('Expected positive hue grid size')
        turn = F(int(turn*scale+(F(1, 2) if nearest else 0)), scale) % 1
    sextant = turn*6
    sector = int(sextant)
    fraction = sextant-sector
    orders = [(2, 1, 0), (2, 0, 1), (0, 2, 1), (0, 1, 2), (1, 0, 2), (1, 2, 0)]
    return orders[sector], fraction if sector % 2 == 0 else 1-fraction


def hue_grid_evidence(rows):
    rows = conversion_rows(rows)
    models = []
    bases = sorted({c['base'] for c, _ in rows})
    for scale, nearest in [(None, False)] + [(s, n) for s in (240, 255, 256, 360, 1530, 1536, 65535, 65536) for n in (False, True)]:
        failures = []
        for base in bases:
            hue = hue_sector(base, scale, nearest)
            if hue is None:
                continue
            order, ratio = hue
            proof = fixed_hue_bounds([(c, n) for c, n in rows if c['base'] == base], order)
            if proof['rejected'] or ratio < F(proof['lower']) or ratio > F(proof['upper']) or (
                    ratio == F(proof['lower']) and proof['lowerOpen']) or (
                    ratio == F(proof['upper']) and proof['upperOpen']):
                failures.append(dict(base=base, order=list(order), relativeChannel=str(ratio), **proof))
        models.append(dict(scale=scale, rounding='nearest' if nearest else 'floor' if scale else 'unquantized',
                           rejectedBases=len(failures), rejectedSourceColors=[f['base'] for f in failures],
                           firstCounterexample=failures[0] if failures else None))
    return models


def relative_channel_hue(base):
    """Represent a floor-255 relative-channel hue as an exact RGB triplet."""
    source = list(bytes.fromhex(base))
    low, high = min(source), max(source)
    return bytes(int(F(channel-low, high-low)*255) if high != low else 0
                 for channel in source).hex()


def relative_hue_evidence(rows):
    active = conversion_rows(rows)
    models = []
    for encoding, bias in [('floor', F(0)), ('nearest', F(1, 2))]:
        rejected = []
        for case, native in active:
            hue = relative_channel_hue(case['base'])
            proof = feasible(hue, native['rgb'], bias)
            if not proof['feasible']:
                rejected.append(dict(case, native=native['rgb'], hueRepresentative=hue, **proof))
        models.append(dict(encoding=encoding, cases=len(active), feasible=len(active)-len(rejected),
                           rejected=len(rejected), firstCounterexample=rejected[0] if rejected else None))
    return models


def evidence():
    results = []
    all_rows = []
    for name in SETS:
        directory = ROOT/'tests/fixtures'/name
        rows = load_rows(directory)  # Verifies every original native binding.
        all_rows.extend([(dict(case, fixture=name), native) for case, native in rows])
        models = []
        for label, bias in [('floor', F(0)), ('nearest', F(1, 2))]:
            for exact in [False, True]:
                rejected = []
                for case, native in rows:
                    proof = feasible(case['base'], native['rgb'], bias, transformed_light(case) if exact else None)
                    if not proof['feasible']:
                        rejected.append(dict(case, native=native['rgb'], **proof))
                models.append(dict(encoding=label, lightness='exact specified transform' if exact else 'arbitrary per modifier',
                                   feasible=len(rows)-len(rejected), rejected=len(rejected), firstCounterexample=rejected[0] if rejected else None))
        results.append(dict(set=name, cases=len(rows), models=models,
                            caseSha256=sha256((directory/'cases.json').read_bytes()).hexdigest()))
    return dict(scope='Source hue preserved, arbitrary saturation per modifier; arbitrary or exact transformed lightness; uniform final floor or nearest RGB encoding. Necessary feasibility only, not a color renderer or certification.',
                totalCases=sum(r['cases'] for r in results), results=results,
                neutralIdentityRows=len(all_rows)-len(conversion_rows(all_rows)),
                conversionRows=len(conversion_rows(all_rows)),
                fixedHueScope='Neutral FF rows verify source identity and bypass conversion. Remaining rows cover all six hue sectors, arbitrary initial hue and arbitrary per-modifier lightness/saturation; empty necessary intervals reject uniform final floor and nearest. Nonempty is inconclusive.',
                fixedHueResults=fixed_hue_evidence(all_rows),
                hueGridScope='Neutral FF source identities bypass conversion. Necessary interval tests of uniform initial hue grids on remaining modifiers, with arbitrary per-modifier lightness/saturation. Rejection covers both uniform final floor and nearest; a surviving grid is inconclusive.',
                hueGridResults=hue_grid_evidence(all_rows),
                relativeHueScope='Floor source relative channel positions to a 255-step grid, preserving extrema. Exact native RGB-box feasibility with arbitrary per-modifier lightness/saturation; neutral FF bypasses conversion. Survival is not a conversion algorithm or rendering pass.',
                relativeHueResults=relative_hue_evidence(all_rows))


if __name__ == '__main__':
    result = evidence()
    output = ROOT/'docs/evidence/theme-hue-feasibility-2026-10-04.json'
    output.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result, indent=2))
