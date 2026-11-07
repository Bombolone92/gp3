"""Compare global texture/coverage sampling hypotheses on an owned control.

Native pixels are comparison targets only. Exit zero means the audit completed,
not that a candidate is suitable for production or matches the native reference.
"""
import argparse
from io import BytesIO
import json
import math
from pathlib import Path
from zipfile import ZipFile

import numpy as np
from PIL import Image
import probe_shadow_native_grid as probe


def sample_mask(source, size, box, mode, sampling, rounding):
    """Keep shape coverage fixed; vary only the alpha-texture sampling law."""
    bx, by, bw, bh = box
    pos = np.arange(size, dtype=float)
    height, width = source.shape

    def texture(x, y):
        xc = np.clip((x - bx) / bw * width - .5, 0, width - 1)
        yc = np.clip((y - by) / bh * height - .5, 0, height - 1)
        if sampling == 'nearest':
            values = source[np.floor(yc + .5).astype(int)[:, None], np.floor(xc + .5).astype(int)[None, :]]
        elif sampling == 'bilinear':
            ix, iy = np.floor(xc).astype(int), np.floor(yc).astype(int)
            tx, ty = xc - ix, yc - iy
            horizontal = source[:, ix] * (1 - tx) + source[:, np.minimum(ix + 1, width - 1)] * tx
            values = horizontal[iy, :] * (1 - ty[:, None]) + horizontal[np.minimum(iy + 1, height - 1), :] * ty[:, None]
        else:
            raise ValueError('Unknown texture sampler')
        return np.floor(values + .5) if rounding == 'byte-samples' else values

    mask = np.zeros((size, size))
    center = texture(pos + .5, pos + .5) if mode == 'center' else None
    for sy in range(4):
        y = pos + sy / 4
        vy = (y >= by) & (y < by + bh)
        for sx in range(8):
            x = pos + sx / 8
            vx = (x >= bx) & (x < bx + bw)
            if mode == 'center':
                values = center
            elif mode == 'coupled-corners':
                values = texture(x, y)
            elif mode == 'coupled-centers':
                values = texture(x + 1 / 16, y + 1 / 8)
            else:
                raise ValueError('Unknown coverage/texture model')
            mask += values * (vy[:, None] & vx[None, :]) / 32
    return np.floor(mask + .5)


def render(mask, sigma):
    radius = math.floor(3 * sigma)
    weights = np.exp(-np.arange(-radius, radius + 1) ** 2 / (2 * sigma * sigma))
    weights /= weights.sum()
    weights = np.floor(weights * 32768 + .5)
    weights[radius] += 32768 - weights.sum()
    weights /= 32768
    for axis in [1, 0]:
        mask = np.floor(np.apply_along_axis(lambda row: np.convolve(row, weights, 'same'), axis, mask) + .5)
    # This owned control declares a 60%-opaque 8040C0 brush.
    rgba = np.floor(mask[:, :, None] * np.array([77, 38, 115, 153]) / 255 + .5).astype(int)
    alpha = rgba[:, :, 3]
    reciprocal = np.zeros_like(alpha)
    np.floor_divide(255 * 65536, alpha, out=reciprocal, where=alpha != 0)
    rgba[:, :, :3] = rgba[:, :, :3] * reciprocal[:, :, None] // 65536
    return rgba


def read_trace(path):
    path = Path(path)
    if path.stat().st_size > 16_000_000:
        raise ValueError('Diagnostic input exceeds the byte budget')
    data = path.read_bytes()
    trace = json.loads(data)
    image = trace['inputMask']
    if (trace['width'], trace['height'], image['width'], image['height']) != (140, 140, 384, 384):
        raise ValueError('Expected the owned control dimensions')
    alpha = image['alpha']
    if len(alpha) != 384 * 384 or not all(type(v) is int and 0 <= v <= 255 for v in alpha):
        raise ValueError('Expected bounded byte-valued texture alpha')
    geometry = trace['geometry']
    for name, expected in [('sourceWidth', 192), ('sourceHeight', 192), ('blur', 48), ('sx', 1.02), ('sy', 1.02)]:
        if geometry[name] != expected:
            raise ValueError('Changed authored geometry: ' + name)
    box = [geometry[k] for k in ['boxX', 'boxY', 'boxW', 'boxH']]
    if not all(type(v) in {int, float} and math.isfinite(v) and 0 < v < 140 for v in box):
        raise ValueError('Invalid texture box')
    density = 140 / (192 * 1.02 + 2 * 48 + 2 / (600 / 96))
    if abs(geometry['scaleX'] - density) > 1e-12 or geometry['scaleY'] != geometry['scaleX']:
        raise ValueError('Changed declared filter scale')
    return data, np.array(alpha, dtype=float).reshape(384, 384), box, 16 * density


def audit(mask_buffer):
    folder = probe.ROOT / 'tests/fixtures/scaled-picture-shadows'
    ref_bytes = (folder / 'metafile/reference.json').read_bytes()
    ref = json.loads(ref_bytes)
    for name in ['source.docx', 'metafile/shadow.png', 'metafile/picture.png']:
        if probe.digest((folder / name).read_bytes()) != ref['sha256'][name]:
            raise ValueError('Changed native evidence: ' + name)
    with ZipFile(folder / 'source.docx') as package:
        authored = np.asarray(Image.open(BytesIO(package.read('word/media/surface-texture.png'))).convert('RGBA')).astype(int)
    picture = np.asarray(Image.open(folder / 'metafile/picture.png').convert('RGBA')).astype(int)
    native = np.asarray(Image.open(folder / 'metafile/shadow.png').convert('RGBA')).astype(int)
    if authored.shape != (144, 144, 4) or picture.shape != authored.shape or native.shape != (140, 140, 4):
        raise ValueError('Changed native/authored extents')
    data, browser, box, sigma = read_trace(mask_buffer)
    rows = []
    for preparation, source in [('authored-144', authored[:, :, 3].astype(float)), ('browser-384', browser)]:
        for mode in ['center', 'coupled-corners', 'coupled-centers']:
            for sampling in ['nearest', 'bilinear']:
                for rounding in ['fractional', 'byte-samples']:
                    predicted = render(sample_mask(source, 140, box, mode, sampling, rounding), sigma)
                    delta = np.abs(predicted - native)
                    delta[:, :, :3][native[:, :, 3] == 0] = 0
                    rows.append(dict(preparation=preparation, mode=mode, sampling=sampling, rounding=rounding,
                        wrongRgba=int(np.any(delta != 0, axis=2).sum()), wrongAlpha=int(np.count_nonzero(delta[:, :, 3])),
                        maxAlpha=int(delta[:, :, 3].max()), signedAlphaSum=int((predicted[:, :, 3] - native[:, :, 3]).sum())))
    return dict(scope='All 24 global sampling hypotheses; comparison only, no native-fitted input or production change.',
        sourceSha256=ref['sha256']['source.docx'], nativeReferenceSha256=probe.digest(ref_bytes),
        nativeShadowSha256=ref['sha256']['metafile/shadow.png'], browserTraceSha256=probe.digest(data),
        pictureAlphaWrong=int(np.count_nonzero(authored[:, :, 3] - picture[:, :, 3])),
        pictureMaxRgba=int(np.abs(authored - picture).max()), geometryBox=box, rows=rows)


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
    print(json.dumps(dict(models=len(report['rows']), exact=sum(r['wrongRgba'] == 0 for r in report['rows']),
        pictureAlphaWrong=report['pictureAlphaWrong'])))


if __name__ == '__main__':
    main()
