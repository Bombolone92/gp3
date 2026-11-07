"""Unreleased portable Fant hypothesis; compare with Windows WIC, exit 1 on any mismatch.

Requires NumPy and Pillow. Writes original sources and native reference rasters
to the requested scratch directory. This is not imported by the renderer.
"""
from pathlib import Path
from hashlib import sha256
import argparse
import json
import numpy as np
from PIL import Image
from wic_fant_reference import scale_rgb, scale_float_rgb


def reduce_axis(pixels, target):
    pixels = pixels.astype(np.float32)
    size = pixels.shape[0]
    if not 1 <= target <= size:
        raise ValueError('This probe only covers reduction and identity')
    result = np.empty((target, *pixels.shape[1:]), dtype=np.float32)
    scale = size / target
    reciprocal = np.float32(1 / scale)
    for output in range(target):
        low, high = output * scale, (output + 1) * scale
        first = int(np.floor(low))
        fraction = np.float32(1 - (low - first))
        following = min(first + 1, size - 1)
        # Native impulse evidence requires a blended starting sample, then
        # coverage weighting. Ordinary area averaging misses this operation.
        value = (pixels[first] * fraction + pixels[following] * (np.float32(1) - fraction)) * fraction
        for source in range(first + 1, min(size, int(np.ceil(high)))):
            value = value + pixels[source] * np.float32(min(high, source + 1) - source)
        result[output] = value * reciprocal
    return result


def reduce_float_rgb(pixels, width, height):
    horizontal = reduce_axis(pixels.swapaxes(0, 1), width).swapaxes(0, 1)
    return reduce_axis(horizontal, height)


def reduce_rgb(pixels, width, height):
    return np.floor(reduce_float_rgb(pixels, width, height) + np.float32(.5)).clip(0, 255).astype(np.uint8)


def cases():
    random = np.random.default_rng(20260928)
    sizes = [(67, 255, 34, 128), (69, 257, 18, 65), (1251, 643, 313, 161),
             (37, 29, 12, 9), (34, 128, 16, 60), (32, 120, 16, 60), (10, 9, 3, 4)]
    for width, height, target_width, target_height in sizes:
        for kind in ['noise', 'ramp', 'checker']:
            if kind == 'noise':
                pixels = random.integers(0, 256, (height, width, 3), dtype=np.uint8)
            else:
                gray = (np.indices((height, width)).sum(axis=0) % 2) * 255 if kind == 'checker' else np.arange(height * width).reshape(height, width) % 256
                pixels = np.repeat(gray[:, :, None], 3, axis=2).astype(np.uint8)
            yield f'{width}-{height}-{target_width}-{target_height}-{kind}', pixels, target_width, target_height
    random = np.random.default_rng(48281)
    for index in range(100):
        width, height = map(int, random.integers(2, 180, size=2))
        target_width, target_height = int(random.integers(1, width + 1)), int(random.integers(1, height + 1))
        pixels = random.integers(0, 256, (height, width, 3), dtype=np.uint8)
        yield f'random-{index}', pixels, target_width, target_height
    for row in [89, 90, 91]:
        pixels = np.full((255, 4, 3), 128, dtype=np.uint8)
        pixels[row] = 255
        yield f'impulse-row-{row}', pixels, 4, 128


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--float-reference', action='store_true', help='Record native floating-point intermediates and verify their byte conversion')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    records = []
    for name, pixels, width, height in cases():
        source = args.output / (name + '.png')
        Image.fromarray(pixels).save(source)
        native = scale_rgb(source, width, height)
        native_path = args.output / (name + '-native.png')
        native.save(native_path)
        floating = reduce_float_rgb(pixels, width, height)
        actual = np.floor(floating + np.float32(.5)).clip(0, 255).astype(np.uint8)
        errors = np.abs(actual.astype(int) - np.array(native).astype(int))
        record = dict(case=name, sourceSize=[pixels.shape[1], pixels.shape[0]], targetSize=[width, height],
                            sourceSha256=sha256(source.read_bytes()).hexdigest(),
                            nativeSha256=sha256(native_path.read_bytes()).hexdigest(),
                            maxError=int(errors.max()), totalError=int(errors.sum()),
                            changedChannels=int((errors != 0).sum()))
        if args.float_reference:
            native_float = scale_float_rgb(pixels, width, height)
            float_path = args.output / (name + '-native-float.npy')
            np.save(float_path, native_float)
            rounded = np.floor(native_float + np.float32(.5)).clip(0, 255).astype(np.uint8)
            record.update(nativeFloatSha256=sha256(float_path.read_bytes()).hexdigest(),
                          nativeFloatByteDifferences=int((rounded != np.array(native)).sum()),
                          floatMaxError=float(np.abs(floating - native_float).max()),
                          floatDifferentChannels=int((floating != native_float).sum()),
                          failingPixels=[dict(at=at.tolist(), candidateFloat=float(floating[tuple(at)]),
                                              nativeFloat=float(native_float[tuple(at)]), nativeByte=int(np.array(native)[tuple(at)]))
                                         for at in np.argwhere(errors != 0)])
        records.append(record)
    (args.output / 'comparison.json').write_text(json.dumps(records, indent=2) + '\n')
    failures = [r for r in records if r['changedChannels']]
    if args.float_reference:
        print('Native float-to-byte exact:', sum(r['nativeFloatByteDifferences'] == 0 for r in records), '/', len(records))
        if any(r['nativeFloatByteDifferences'] for r in records):
            return 2
    print(f'Exact native RGB: {len(records) - len(failures)}/{len(records)}')
    for failure in failures:
        print(failure)
    return int(bool(failures))


if __name__ == '__main__':
    raise SystemExit(main())
