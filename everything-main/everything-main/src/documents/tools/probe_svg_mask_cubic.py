"""Unreleased cubic-integration hypothesis; requires NumPy, Pillow and lxml.

This intentionally exits 1 while any native comparison fails. It must not be
used as the renderer or as a passing conformance certificate.
"""
from pathlib import Path
from zipfile import ZipFile
from io import BytesIO
from hashlib import sha256
import argparse, base64, json
from lxml import etree
from PIL import Image
import numpy as np

repo = Path(__file__).resolve().parents[1]

def cubic(distance):
    x = np.abs(distance)
    return np.where(x < 1, x**3 - 2*x*x + 1,
                    np.where(x < 2, -x**3 + 5*x*x - 8*x + 4, 0))

def sampled_weights(size, target):
    scale = size / target
    result = np.zeros((target, size))
    for output in range(target):
        center = (output + .5) * scale
        for source in range(int(np.floor(center - 2*scale)) - 1,
                            int(np.ceil(center + 2*scale)) + 1):
            # Right-endpoint integration: 64 samples within each source pixel.
            weight = cubic((source + np.arange(1, 65)/64 - center)/scale).mean()/scale
            reflected = source if 0 <= source < size else -source-1 if source < 0 else 2*size-source-1
            if 0 <= reflected < size:
                result[output, reflected] += weight
    return result

def integral_weights(size, target, float_reciprocal=False):
    # Original diagnostic hypothesis, not a native implementation or renderer.
    # A fixed grid differs from taking 64 samples inside every source pixel
    # when the reduction ratio is not two. Right-endpoint integration and
    # floor lookup are explicitly tested assumptions, not certified behavior.
    resolution = 128
    grid = np.arange(-2 * resolution, 2 * resolution + 1) / resolution
    cumulative = np.concatenate([[0], np.cumsum(cubic(grid[1:]) / resolution)])
    def integral(value):
        index = int(np.floor(np.clip((value + 2) * resolution, 0, 4 * resolution)))
        return cumulative[index]
    scale = size / target
    result = np.zeros((target, size))
    for output in range(target):
        center = (output + .5) * scale
        for source in range(int(np.floor(center - 2 * scale)) - 1, int(np.ceil(center + 2 * scale)) + 1):
            weight = integral((source + 1 - center) / scale) - integral((source - center) / scale)
            if float_reciprocal:
                inverse = float(np.float32(1 / scale))
                weight = integral((source + 1 - center) * inverse) - integral((source - center) * inverse)
            reflected = source if 0 <= source < size else -source - 1 if source < 0 else 2 * size - source - 1
            if 0 <= reflected < size:
                result[output, reflected] += weight
    return result

def centered_weights(size, target):
    # Native impulse/amplitude controls distinguish a kernel centered on one
    # source pixel from a center between pixels. This hypothesis matches the
    # integer controls; do not treat that as a general resampling contract.
    result = integral_weights(size, target)
    scale = size / target
    resolution = 128
    cumulative = np.concatenate([[0], np.cumsum(cubic(np.arange(1, 257) / resolution) / resolution)])
    def positive(value):
        return cumulative[int(np.floor(np.clip(value * resolution, 0, 256)))]
    for output in range(target):
        center = (output + .5) * scale
        if abs((center - .5) - round(center - .5)) > 1e-9:
            continue
        result[output] = 0
        for source in range(int(np.floor(center - 2 * scale)) - 1, int(np.ceil(center + 2 * scale)) + 1):
            low, high = (source - center) / scale, (source + 1 - center) / scale
            if high <= 0:
                weight = positive(-low) - positive(-high)
            elif low >= 0:
                weight = positive(high) - positive(low)
            else:
                weight = positive(high) + positive(-low) + 1 / resolution
            reflected = source if 0 <= source < size else -source - 1 if source < 0 else 2 * size - source - 1
            if 0 <= reflected < size:
                result[output, reflected] += weight
    return result

def accumulated_weights(size, target, extent=None, origin=0):
    # Original diagnostic hypothesis: quantize the cumulative table, then
    # advance the lookup coordinate once per source pixel. Recomputing each
    # coordinate is not equivalent at integer boundaries in finite precision.
    # Three fractional fixtures still fail; this is not a renderer algorithm.
    scale = size / (target if extent is None else extent)
    step = 128 / scale
    table = np.concatenate([[0], np.cumsum(cubic(np.arange(-255, 257) / 128) / 128)])
    table = np.round(table * 65536) / 65536
    result = np.zeros((target, size))
    for output in range(target):
        center = (output + .5 - origin) * scale
        start = int(np.floor(center - 2 * scale)) - 1
        index = ((start - center) / scale + 2) * 128
        for source in range(start, int(np.ceil(center + 2 * scale)) + 2):
            following = index + step
            weight = table[int(np.floor(np.clip(following, 0, 512)))] - table[int(np.floor(np.clip(index, 0, 512)))]
            reflected = source if 0 <= source < size else -source - 1 if source < 0 else 2 * size - source - 1
            if 0 <= reflected < size:
                result[output, reflected] += weight
            index = following
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    kernels = parser.add_mutually_exclusive_group()
    kernels.add_argument('--integral-table', action='store_true', help='Test a held 128-samples-per-kernel-unit integral-table hypothesis')
    kernels.add_argument('--centered-grid', action='store_true', help='Test the held centered-grid hypothesis; fractional comparisons remain failing')
    kernels.add_argument('--float-reciprocal', action='store_true', help='Test float32 inverse scale coordinates; fractional impulse counterexamples remain failing')
    kernels.add_argument('--accumulated-grid', action='store_true', help='Test 16-bit cumulative values and incremental lookup indices; fractional failures remain')
    parser.add_argument('--include-three', action='store_true', help='Include six independent 3:1 kernel controls')
    parser.add_argument('--include-amplitudes', action='store_true', help='Include six 3:1 band-amplitude counterexamples')
    parser.add_argument('--include-fractional', action='store_true', help='Include six fractional reductions, using the held portable Fant prefilter for odd dimensions')
    parser.add_argument('--include-fractional-impulses', action='store_true', help='Include six independent 1.5:1 impulse weight controls')
    args = parser.parse_args()

    weights = centered_weights if args.centered_grid else integral_weights if args.integral_table else sampled_weights
    if args.float_reciprocal:
        weights = lambda size, target: integral_weights(size, target, float_reciprocal=True)
    if args.accumulated_grid:
        weights = accumulated_weights
    controls = ['svg-image-mask-kernel', 'svg-image-mask-phase', 'svg-image-mask-scales']
    if args.include_three:
        controls.append('svg-image-mask-kernel-three')
    if args.include_amplitudes:
        controls.append('svg-image-mask-amplitudes')
    if args.include_fractional:
        controls.append('svg-image-mask-fractional')
    if args.include_fractional_impulses:
        controls.append('svg-image-mask-fractional-impulses')
    results = []
    for name in controls + ['svg-image-masks-scaled', 'svg-image-masks-step']:
        folder = repo / 'tests/fixtures' / name
        reference = json.loads((folder / 'metafile-reference.json').read_text())
        source = folder / 'control.docx' if name in controls else repo / 'public/fixtures' / (name + '.docx')
        assert sha256(source.read_bytes()).hexdigest() == reference['sourceSha256']
        with ZipFile(source) as package:
            svg = etree.fromstring(package.read('word/media/vector.svg'))
        images = svg.findall('.//{http://www.w3.org/2000/svg}image')
        selected = list(enumerate(images)) if name in controls else [(2, images[0])]
        for index, element in selected:
            image = Image.open(BytesIO(base64.b64decode(element.get('href').split(',', 1)[1]))).convert('RGB')
            rgb = np.array(image)
            assert np.array_equal(rgb[:, :, 0], rgb[:, :, 1]) and np.array_equal(rgb[:, :, 0], rgb[:, :, 2])
            factor = image.width / 16
            assert image.height / 60 == factor and factor in [1, 1.25, 1.5, 2, 2.25, 2.5, 3, 3.5, 4, 4.25, 6, 8]
            block = 1
            while factor / block >= 4:
                block *= 2
            gray = rgb[:, :, 0].astype(float)
            if block > 1:
                if image.width % block or image.height % block:
                    from probe_svg_mask_fant import reduce_rgb
                    gray = reduce_rgb(rgb, (image.width + block - 1) // block, (image.height + block - 1) // block)[:, :, 0].astype(float)
                else:
                    gray = np.floor(gray.reshape(image.height//block, block, image.width//block, block).mean(axis=(1, 3)) + .5)
            if gray.shape != (60, 16):
                horizontal = np.floor((gray @ weights(gray.shape[1], 16).T).clip(0, 255) + .5)
                actual = np.floor((weights(gray.shape[0], 60) @ horizontal).clip(0, 255) + .5)
            else:
                actual = gray
            entry = reference['images'][index]
            native_path = folder / entry['path']
            assert sha256(native_path.read_bytes()).hexdigest() == entry['sha256']
            native = np.array(Image.open(native_path).getchannel('A'))[1:61, 1:17]
            errors = np.abs(actual - native)
            results.append(dict(fixture=name, case=index, factor=factor, block=block,
                                sourceSha256=reference['sourceSha256'], nativeSha256=entry['sha256'],
                                maxError=int(errors.max()), totalError=int(errors.sum()),
                                changedPixels=int((errors != 0).sum())))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2) + '\n')
    failures = [result for result in results if result['changedPixels']]
    print(f'Exact native alpha: {len(results)-len(failures)}/{len(results)}')
    for failure in failures:
        print(failure)
    raise SystemExit(1 if failures else 0)


if __name__ == '__main__':
    main()
