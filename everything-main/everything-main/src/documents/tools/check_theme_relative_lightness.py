"""Exact constraints on a proposed theme-color conversion pipeline.

Diagnostic only. A surviving stage is not evidence of the reference implementation.
No source colors or document identifiers are used as renderer lookup tables.
"""
from fractions import Fraction as F
import json
from check_theme_chroma_stages import ROOT, SETS, load_rows
from check_theme_hue_feasibility import conversion_rows, relative_channel_hue, feasible, transformed_light


def light_units(case):
    """Floor specified transformed lightness to sixths of a byte exactly."""
    return int(transformed_light(case)*6)


def chroma_bounds(units, hue, rgb):
    """All integer chroma thirds which encode the native channels.

    Channel numerator is 255*units+(2*hue-255)*chroma, denominator 1530.
    The upper RGB bound is open; subtracting one is exact for integer numerators.
    Channel inequalities and the HSL gamut each impose an integer interval.
    """
    if type(units) is not int or not 0 <= units <= 1530 or len(hue) != 3 or len(rgb) != 3:
        raise ValueError('Invalid color frame')
    if any(type(n) is not int or not 0 <= n <= 255 for n in [*hue, *rgb]):
        raise ValueError('Expected channel bytes')
    lower, upper = 0, min(units, 1530-units)
    for position, native in zip(hue, rgb, strict=True):
        coefficient = 2*position-255
        intercept = 255*units
        if coefficient > 0:
            lower = max(lower, -((intercept-1530*native)//coefficient))
            upper = min(upper, (1530*(native+1)-1-intercept)//coefficient)
        else:
            divisor = -coefficient
            lower = max(lower, -((1530*(native+1)-1-intercept)//divisor))
            upper = min(upper, (intercept-1530*native)//divisor)
    return (lower, upper) if lower <= upper else None


def fixed_saturation(rows):
    """Allow ANY fixed source saturation, then floor chroma to thirds.

    This includes every possible initial saturation quantizer under this
    pipeline, rather than testing a finite grid of chosen source saturations.
    """
    states = {}
    missing = []
    chromatic = uninformative = 0
    for case, native in conversion_rows(rows):
        source = list(bytes.fromhex(case['base']))
        low, high = min(source), max(source)
        if high == low:
            continue  # The separately validated achromatic conversion applies.
        chromatic += 1
        units = light_units(case)
        maximum = min(units, 1530-units)
        hue = list(bytes.fromhex(relative_channel_hue(case['base'])))
        state = states.setdefault(case['base'], dict(lower=F(0), upper=F(1), upperOpen=False))
        bounds = chroma_bounds(units, hue, native['rgb'])
        if bounds is None:
            counterexample = dict(case, native=native['rgb'], lightUnits=units)
            missing.append(counterexample)
            state.setdefault('gridCounterexample', counterexample)
            continue
        if maximum == 0:
            uninformative += 1
            continue
        minimum, maximum_chroma = bounds
        lower, upper = F(minimum, maximum), F(maximum_chroma+1, maximum)
        witness = dict(case, native=native['rgb'], lightUnits=units,
                       chromaMinimum=minimum, chromaMaximum=maximum_chroma, factor=maximum)
        if lower > state['lower']:
            state.update(lower=lower, lowerCounterexample=witness)
        if upper <= state['upper']:
            state.update(upper=upper, upperOpen=True, upperCounterexample=witness)
    results = []
    for base, state in sorted(states.items()):
        rejected = 'gridCounterexample' in state or state['lower'] > state['upper'] or (state['lower'] == state['upper'] and state['upperOpen'])
        results.append(dict(base=base, rejected=rejected,
                            **{k: str(v) if isinstance(v, F) else v for k, v in state.items()}))
    return dict(chromaticConversionRows=chromatic, zeroChromaRows=uninformative,
                noChromaGridIntersection=len(missing), firstGridCounterexample=missing[0] if missing else None,
                rejectedSources=sum(r['rejected'] for r in results), results=results)


def light_models(rows):
    active = conversion_rows(rows)
    results = []
    for grid, nearest in [(None, False), (1, False), (6, False), (6, True), (255, False), (256, False)]:
        failures = []
        for case, native in active:
            light = transformed_light(case)
            if grid:
                light = F(int(light*grid+(F(1, 2) if nearest else 0)), grid)
            proof = feasible(relative_channel_hue(case['base']), native['rgb'], exact_light=light)
            if not proof['feasible']:
                failures.append(dict(case, native=native['rgb'], lightness=str(light), **proof))
        results.append(dict(gridPerByte=grid, rounding='nearest half-up' if nearest else 'floor' if grid else 'exact',
                            cases=len(active), rejected=len(failures),
                            firstCounterexample=failures[0] if failures else None))
    return results


def bias_free_saturation(rows):
    """Necessary S intervals allowing ANY constant chroma rounding bias.

    C=clamp(floor(M*S+b),0,M), with a separate arbitrary b for each source.
    Interior native bounds require c_min <= M*S+b < c_max+1. Eliminating b
    between every lower/upper pair gives strict rational S bounds. Gamut-clamp
    endpoint constraints are one-sided, so they never spuriously reject b.
    """
    sources = {}
    for case, native in conversion_rows(rows):
        rgb = list(bytes.fromhex(case['base']))
        if min(rgb) == max(rgb):
            continue
        units = light_units(case)
        factor = min(units, 1530-units)
        if not factor:
            continue
        bounds = chroma_bounds(units, list(bytes.fromhex(relative_channel_hue(case['base']))), native['rgb'])
        if bounds is None:
            raise ValueError('No chroma-grid intersection; bias elimination is inapplicable')
        sources.setdefault(case['base'], []).append(dict(case, native=native['rgb'], factor=factor,
                                                         chromaMinimum=bounds[0], chromaMaximum=bounds[1]))
    results = []
    for base, cases in sorted(sources.items()):
        lower, upper = F(0), F(1)
        lower_open = upper_open = False
        lower_witness = upper_witness = same_factor = None
        for first in cases:
            if first['chromaMinimum'] == 0:
                continue  # Gamut clipping allows arbitrarily negative b here.
            for second in cases:
                if second['chromaMaximum'] == second['factor']:
                    continue  # Gamut clipping allows arbitrarily positive b.
                difference = second['factor']-first['factor']
                rhs = second['chromaMaximum']+1-first['chromaMinimum']
                witness = dict(lowerCase=first, upperCase=second)
                if difference == 0:
                    if rhs <= 0:
                        same_factor = witness
                    continue
                bound = F(rhs, difference)
                if difference < 0 and bound >= lower:
                    lower, lower_open, lower_witness = bound, True, witness
                elif difference > 0 and bound <= upper:
                    upper, upper_open, upper_witness = bound, True, witness
        rejected = same_factor is not None or lower > upper or (lower == upper and (lower_open or upper_open))
        results.append(dict(base=base, rejected=rejected, lower=str(lower), upper=str(upper),
                            lowerOpen=lower_open, upperOpen=upper_open, lowerWitness=lower_witness,
                            upperWitness=upper_witness, sameFactorCounterexample=same_factor))
    return dict(scope='Same relative-hue/lightness/chroma-grid pipeline, but arbitrary fixed source saturation AND arbitrary fixed chroma rounding bias; gamut clipping allowed. Empty necessary intervals reject floor/nearest/ceil and other fixed biases. Nonempty remains inconclusive.',
                rejectedSources=sum(r['rejected'] for r in results), results=results)


def evidence():
    rows = [(dict(c, fixture=name), n) for name in SETS for c, n in load_rows(ROOT/'tests/fixtures'/name)]
    return dict(scope='Hash-bound native reference constraints only. Relative-channel hue floor-255 and final floor; lightness model comparisons allow arbitrary per-modifier saturation. Fixed-saturation test additionally floors chroma to thirds after lightness floor-sixths. Survival does not identify native stages; rejection applies only to the stated pipeline.',
                totalRows=len(rows), conversionRows=len(conversion_rows(rows)),
                lightModels=light_models(rows), fixedSaturation=fixed_saturation(rows),
                arbitraryRoundingBias=bias_free_saturation(rows))


if __name__ == '__main__':
    result = evidence()
    output = ROOT/'docs/evidence/theme-relative-lightness-2026-10-04.json'
    output.write_text(json.dumps(result, indent=2)+'\n')
    print('Conversion rows:', result['conversionRows'])
    print('Light model rejections:', [(r['gridPerByte'], r['rounding'], r['rejected']) for r in result['lightModels']])
    print('Rejected fixed-saturation sources:', result['fixedSaturation']['rejectedSources'])
