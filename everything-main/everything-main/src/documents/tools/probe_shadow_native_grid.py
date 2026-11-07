"""Test global square-mask grid/filter hypotheses against owned native PNGs.

Exit zero means the diagnostic completed, not that a model matches the native reference.
No native coordinate lookup, per-case model selection or runtime edits.
"""
import argparse
import hashlib
from io import BytesIO
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from check_shadow_axis_symmetry import shadow_png

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'tests/fixtures/shadow-alpha-pipeline'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def grid_size(extent, blur):
    density = 600 / 72
    return math.floor((extent * density + 2 + 2 * blur * density) / (1 + blur / 3) + .5)


def boundary_dimensions():
    folder = ROOT / 'tests/fixtures/shadow-grid-boundary'
    data = (folder / 'native-metafile-grid.json').read_bytes()
    ref = json.loads(data)
    for name, field in [('source.docx', 'sourceSha256'), ('cases.json', 'casesSha256')]:
        if digest((folder / name).read_bytes()) != ref[field]:
            raise ValueError(f'Changed boundary source: {name}')
    rows = []
    for case in ref['cases']:
        predicted = [grid_size(case[k], case['blurPt']) for k in ['widthPt', 'heightPt']]
        native = case['images'][0]['size']
        rows.append(dict(name=case['name'], predictedSize=predicted, nativeSize=native,
                         dimensionMatches=predicted == native))
    return dict(referenceSha256=digest(data), sourceSha256=ref['sourceSha256'], referenceBuild=ref['referenceBuild'],
                scope='Metafile image dictionary dimensions only; no blur or final-raster comparison.', rows=rows)


def predict(case, grid, support, intermediate, *, coefficient_bits=None, mask_sampling='area', mask_rounding='nearest'):
    """One rule per model, applied unchanged to every source alpha/blur/color."""
    if mask_rounding not in {'nearest', 'floor', 'fractional'}:
        raise ValueError('Unknown diagnostic mask rounding')
    if mask_rounding != 'nearest' and mask_sampling != 'padding-parity-8x4':
        raise ValueError('Initial rounding hypotheses require the box sampler')
    blur, width = case['blurPt'], case['widthPt']
    density = 600 / 72
    factor = 1 + blur / 3
    predicted_size = grid_size(width, blur)
    # Using a rounded output extent is a distinct hypothesis from keeping
    # the nominal downsample factor. Neither is selected by source identity.
    scale = density / factor if grid == 'nominal-factor' else predicted_size / (width + 2 / density + 2 * blur)
    span = math.floor(width * scale)
    x = np.arange(predicted_size) - (predicted_size - 1) / 2
    mask = np.maximum(0, np.minimum(x + .5, span / 2) - np.maximum(x - .5, -span / 2))
    if blur:
        sigma = blur / 3 * scale
        radius = math.floor(3 * sigma) if support == 'floor' else math.ceil(3 * sigma)
        weights = np.exp(-np.arange(-radius, radius + 1, dtype=float) ** 2 / (2 * sigma * sigma))
        weights /= weights.sum()
        if coefficient_bits is not None:
            # Diagnostic hypothesis, never selected by document/case identity.
            # Preserve the total by assigning the rounding residual to center.
            power = 2 ** coefficient_bits
            integral = np.floor(weights * power + .5)
            integral[radius] += power - integral.sum()
            weights = integral / power
        filtered = np.convolve(mask, weights, 'same')
    else:
        filtered = mask
    source = case['sourceAlpha']
    if intermediate == 'horizontal-byte':
        horizontal = np.floor(source * filtered + .5)
        q = np.floor(filtered[:, None] * horizontal[None, :] + .5)
    else:
        q = np.floor(source * filtered[:, None] * filtered[None, :] + .5)
    if mask_sampling == 'padding-parity-8x4':
        # Original diagnostic sampler inferred from owned controls and checked
        # against the public Windows 8x4 box-filter API. No native pixel lookup.
        antialias = (predicted_size - span) % 2 != 0
        extent = width * scale if antialias else span
        start = (predicted_size - extent) / 2
        positions = np.arange(predicted_size)
        if antialias:
            counts_x = sum((positions + i / 8 >= start) & (positions + i / 8 < start + extent) for i in range(8))
            counts_y = sum((positions + i / 4 >= start) & (positions + i / 4 < start + extent) for i in range(4))
            coverage = source * counts_y[:, None] * counts_x[None, :] / 32
            if mask_rounding == 'nearest':
                q = np.floor(coverage + .5)
            elif mask_rounding == 'floor':
                q = np.floor(coverage)
            elif mask_rounding == 'fractional':
                q = coverage
            else:
                raise ValueError('Unknown diagnostic mask rounding')
        else:
            inside = (positions + .5 >= start) & (positions + .5 < start + extent)
            q = source * inside[:, None] * inside[None, :]
        if blur:
            q = np.apply_along_axis(lambda row: np.convolve(row, weights, 'same'), 1, q)
            if intermediate == 'horizontal-byte':
                q = np.floor(q + .5)
            q = np.floor(np.apply_along_axis(lambda row: np.convolve(row, weights, 'same'), 0, q) + .5)
    elif mask_sampling != 'area':
        raise ValueError('Unknown diagnostic mask sampler')
    brush_alpha = math.floor(255 * case['alpha'] / 100000 + .5)
    rgb = [int(case['color'][i:i + 2], 16) for i in (0, 2, 4)]
    brush = [math.floor(v * brush_alpha / 255 + .5) for v in rgb] + [brush_alpha]
    premult = np.floor(q[:, :, None] * np.array(brush) / 255 + .5).astype(np.int64)
    alpha = premult[:, :, 3]
    reciprocal = np.zeros_like(alpha)
    np.floor_divide(255 * 65536, alpha, out=reciprocal, where=alpha != 0)
    rgba = premult.copy()
    rgba[:, :, :3] = premult[:, :, :3] * reciprocal[:, :, None] // 65536
    return predicted_size, rgba.astype(np.uint8)


def audit():
    ref_path = FOLDER / 'reference.json'
    ref_bytes = ref_path.read_bytes()
    reference = json.loads(ref_bytes)
    for name, expected in reference['hashes'].items():
        if digest((FOLDER / name).read_bytes()) != expected:
            raise ValueError(f'Changed native evidence: {name}')
    if len(reference['cases']) != 24:
        raise ValueError('Expected all 24 original controls')
    rows = []
    for index, case in enumerate(reference['cases'], 1):
        if case['widthPt'] != case['heightPt']:
            raise ValueError('This diagnostic only tests square sources')
        png = shadow_png(FOLDER / f'shadow-color-{index}.emf')
        image = Image.open(BytesIO(png)).convert('RGBA')
        if digest(png) != case['images'][0]['pngSha256'] or list(image.size) != case['images'][0]['size']:
            raise ValueError('Changed native image identity')
        actual = np.asarray(image)
        models = []
        for grid in ['nominal-factor', 'rounded-extent']:
            for support in ['floor', 'ceil']:
                for intermediate in ['horizontal-byte', 'final-byte']:
                    n, predicted = predict(case, grid, support, intermediate)
                    result = dict(grid=grid, support=support, intermediate=intermediate, predictedSize=n,
                                  dimensionMatches=image.size == (n, n))
                    if result['dimensionMatches']:
                        alpha_error = np.abs(predicted[:, :, 3].astype(int) - actual[:, :, 3].astype(int))
                        delta = np.abs(predicted.astype(int) - actual.astype(int))
                        # Transparent RGB is undefined; its alpha still counts.
                        delta[:, :, :3][actual[:, :, 3] == 0] = 0
                        bad = np.any(delta != 0, axis=2)
                        witness = np.argwhere(bad)
                        first = witness[0] if len(witness) else None
                        result.update(alphaWrongPixels=int(np.count_nonzero(alpha_error)),
                                      maxAlphaError=int(alpha_error.max()), rgbaWrongPixels=int(bad.sum()),
                                      maxRgbaError=int(delta.max()),
                                      firstWitness=None if first is None else dict(x=int(first[1]), y=int(first[0]),
                                          native=actual[tuple(first)].tolist(), predicted=predicted[tuple(first)].tolist()))
                    models.append(result)
        rows.append(dict(name=case['name'], sourceAlpha=case['sourceAlpha'], blurPt=case['blurPt'],
                         nativeSize=list(image.size), nativePngSha256=digest(png), models=models))
    summary = []
    for i, model in enumerate(rows[0]['models']):
        selected = [row['models'][i] for row in rows]
        summary.append({**{k: model[k] for k in ['grid', 'support', 'intermediate']},
                        'dimensionMatches': sum(r['dimensionMatches'] for r in selected),
                        'exactAlphaCases': sum(r.get('alphaWrongPixels') == 0 for r in selected),
                        'exactRgbaCases': sum(r.get('rgbaWrongPixels') == 0 for r in selected),
                        'rgbaWrongPixels': sum(r.get('rgbaWrongPixels', 0) for r in selected),
                        'allCasesExact': all(r.get('rgbaWrongPixels') == 0 for r in selected)})
    return dict(scope='Global square-mask hypotheses against native exported PNGs; not app rendering, a kernel proof or original-template certification.',
                nativeReferenceSha256=digest(ref_bytes), sourceSha256=reference['hashes']['source.docx'],
                referenceVersion=reference['referenceVersion'], boundaryDimensions=boundary_dimensions(), summary=summary, rows=rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Use a fresh destination; existing evidence is immutable')
    report = audit()
    with args.output.open('x', encoding='utf8') as out:
        out.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['summary']))


if __name__ == '__main__':
    main()
