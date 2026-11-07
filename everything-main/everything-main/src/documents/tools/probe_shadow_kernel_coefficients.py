"""Compare global integer-coefficient hypotheses with all owned native controls.

Exit zero means the experiment completed, not a native match. No app changes,
per-case parameter selection, fitted coordinates or tolerance relaxations.
"""
import argparse
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
import probe_shadow_native_grid as probe


def audit():
    ref_bytes = (probe.FOLDER / 'reference.json').read_bytes()
    reference = json.loads(ref_bytes)
    for name, expected in reference['hashes'].items():
        if probe.digest((probe.FOLDER / name).read_bytes()) != expected:
            raise ValueError(f'Changed native evidence: {name}')
    if len(reference['cases']) != 24:
        raise ValueError('Expected all 24 controls')
    native = []
    for index, case in enumerate(reference['cases'], 1):
        png = probe.shadow_png(probe.FOLDER / f'shadow-color-{index}.emf')
        image = Image.open(BytesIO(png)).convert('RGBA')
        if probe.digest(png) != case['images'][0]['pngSha256'] or list(image.size) != case['images'][0]['size']:
            raise ValueError('Changed native image identity')
        native.append(np.asarray(image))
    models = []
    for bits in [None, 12, 14, 15, 16, 18, 20]:
        rows = []
        for case, actual in zip(reference['cases'], native):
            size, predicted = probe.predict(case, 'rounded-extent', 'floor', 'horizontal-byte', coefficient_bits=bits)
            if actual.shape != (size, size, 4):
                raise ValueError('Unexpected comparison grid')
            delta = np.abs(predicted.astype(int) - actual.astype(int))
            delta[:, :, :3][actual[:, :, 3] == 0] = 0
            bad = np.any(delta != 0, axis=2)
            witnesses = np.argwhere(bad)
            first = witnesses[0] if len(witnesses) else None
            rows.append(dict(name=case['name'], rgbaWrongPixels=int(bad.sum()),
                alphaWrongPixels=int(np.count_nonzero(delta[:, :, 3])), maxAlphaError=int(delta[:, :, 3].max()),
                firstWitness=None if first is None else dict(x=int(first[1]), y=int(first[0]),
                    native=actual[tuple(first)].tolist(), predicted=predicted[tuple(first)].tolist())))
        models.append(dict(coefficientBits=bits, rounding='nearest', normalization='center-residual',
            exactRgbaCases=sum(row['rgbaWrongPixels'] == 0 for row in rows),
            rgbaWrongPixels=sum(row['rgbaWrongPixels'] for row in rows),
            allCasesExact=all(row['rgbaWrongPixels'] == 0 for row in rows), rows=rows))
    return dict(scope='Owned uniform-square native PNG comparison; not app rendering or a proof of native internals.',
        sourceSha256=reference['hashes']['source.docx'], referenceSha256=probe.digest(ref_bytes),
        referenceVersion=reference['referenceVersion'], models=models)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Use a fresh destination; existing evidence is immutable')
    report = audit()
    with args.output.open('x', encoding='utf8') as output:
        output.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps([{k: v for k, v in model.items() if k != 'rows'} for model in report['models']]))


if __name__ == '__main__':
    main()
