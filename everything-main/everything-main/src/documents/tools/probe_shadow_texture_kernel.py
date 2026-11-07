"""Retain global kernel counterexamples across uniform and textured controls.

The texture mask is an owned browser diagnostic capture, not native pixels.
Exit zero means the comparison completed; no renderer or match claim follows.
"""
import argparse
from io import BytesIO
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
import probe_shadow_native_grid as probe


def audit(mask_buffer):
    reference_bytes = (probe.FOLDER / 'reference.json').read_bytes()
    reference = json.loads(reference_bytes)
    for name, expected in reference['hashes'].items():
        if probe.digest((probe.FOLDER / name).read_bytes()) != expected:
            raise ValueError(f'Changed uniform reference: {name}')
    if len(reference['cases']) != 24:
        raise ValueError('Expected all 24 uniform controls')
    uniform = []
    for index, case in enumerate(reference['cases'], 1):
        png = probe.shadow_png(probe.FOLDER / f'shadow-color-{index}.emf')
        image = Image.open(BytesIO(png)).convert('RGBA')
        if probe.digest(png) != case['images'][0]['pngSha256'] or list(image.size) != case['images'][0]['size']:
            raise ValueError('Changed uniform native image identity')
        uniform.append(np.asarray(image).astype(int))
    folder = probe.ROOT / 'tests/fixtures/scaled-picture-shadows'
    texture_ref_bytes = (folder / 'metafile/reference.json').read_bytes()
    texture_ref = json.loads(texture_ref_bytes)
    for name in ['source.docx', 'metafile/shadow.png']:
        if probe.digest((folder / name).read_bytes()) != texture_ref['sha256'][name]:
            raise ValueError(f'Changed texture reference: {name}')
    native = np.asarray(Image.open(folder / 'metafile/shadow.png').convert('RGBA')).astype(int)
    mask_buffer = Path(mask_buffer)
    if mask_buffer.stat().st_size > 16_000_000:
        raise ValueError('Diagnostic mask exceeds the input limit')
    buffer_bytes = mask_buffer.read_bytes()
    buffer = json.loads(buffer_bytes)
    if (buffer['width'], buffer['height']) != (140, 140) or len(buffer['mask']) != 140 * 140:
        raise ValueError('Expected the owned 140-by-140 texture grid')
    if not all(type(value) is int and 0 <= value <= 255 for value in buffer['mask']):
        raise ValueError('Expected byte-valued mask alpha')
    if native.shape != (140, 140, 4):
        raise ValueError('Changed native texture extent')
    mask = np.array(buffer['mask']).reshape(140, 140)
    rows = []
    for bits in [None, 12, 14, 15, 16, 18, 20]:
        exact, wrong = 0, 0
        for case, actual in zip(reference['cases'], uniform):
            _, rgba = probe.predict(case, 'rounded-extent', 'floor', 'horizontal-byte',
                coefficient_bits=bits, mask_sampling='padding-parity-8x4')
            delta = np.abs(rgba.astype(int) - actual)
            delta[:, :, :3][actual[:, :, 3] == 0] = 0
            count = int(np.any(delta != 0, axis=2).sum())
            exact += count == 0
            wrong += count
        # Declared geometry of this independently authored texture control:
        # 144pt square, 102% shadow, 36pt blur; no native-coordinate fitting.
        sigma = 12 * 140 / (144 * 1.02 + 72 + .24)
        radius = math.floor(3 * sigma)
        weights = np.exp(-np.arange(-radius, radius + 1) ** 2 / (2 * sigma * sigma))
        weights /= weights.sum()
        if bits is not None:
            power = 2 ** bits
            weights = np.floor(weights * power + .5)
            weights[radius] += power - weights.sum()
            weights /= power
        q = mask
        for axis in [1, 0]:
            q = np.floor(np.apply_along_axis(lambda row: np.convolve(row, weights, 'same'), axis, q) + .5)
        rgba = np.floor(q[:, :, None] * np.array([77, 38, 115, 153]) / 255 + .5).astype(int)
        alpha = rgba[:, :, 3]
        reciprocal = np.zeros_like(alpha)
        np.floor_divide(255 * 65536, alpha, out=reciprocal, where=alpha != 0)
        rgba[:, :, :3] = rgba[:, :, :3] * reciprocal[:, :, None] // 65536
        delta = np.abs(rgba - native)
        delta[:, :, :3][native[:, :, 3] == 0] = 0
        rows.append(dict(coefficientBits=bits, uniformExactCases=int(exact), uniformWrongRgba=wrong,
            textureWrongRgba=int(np.any(delta != 0, axis=2).sum()),
            textureWrongAlpha=int(np.count_nonzero(delta[:, :, 3])),
            textureMaxAlpha=int(delta[:, :, 3].max()), textureSignedAlphaSum=int((alpha - native[:, :, 3]).sum())))
    return dict(scope='All seven global coefficient hypotheses, all 24 uniform controls, and one owned browser texture mask; no per-case selection or production changes.',
        uniformReferenceSha256=probe.digest(reference_bytes), textureReferenceSha256=probe.digest(texture_ref_bytes),
        textureMaskSha256=probe.digest(buffer_bytes), rows=rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mask-buffer', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Use a fresh destination; existing evidence is immutable')
    report = audit(args.mask_buffer)
    with args.output.open('x', encoding='utf8') as output:
        output.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['rows']))


if __name__ == '__main__':
    main()
