"""Recompute lossless native outline bounds from retained reference page EMFs.

Only bounded GDI bitmap records are decoded; no font programs are read.
The captured page has 5100 x 6600 logical units and 612 x 792 points.
"""
from pathlib import Path
from io import BytesIO
from hashlib import sha256
import gzip
import json
import struct
import numpy as np
from PIL import Image

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/picture-3d-left-outlines'
reference = json.loads((folder / 'native.json').read_text())
assert sha256((folder / 'control.docx').read_bytes()).hexdigest() == reference['capture']['sourceSha256']
for capture, measured in zip(reference['capture']['captures'], reference['measurements'], strict=True):
    data = gzip.decompress((folder / (capture['file'] + '.gz')).read_bytes())
    assert sha256(data).hexdigest() == capture['sha256']
    offset = 0
    images = []
    extent = None
    origin = None
    while offset < len(data):
        kind, size = struct.unpack_from('<II', data, offset)
        assert size >= 8 and size % 4 == 0 and offset + size <= len(data)
        assert kind not in [11, 12, 35, 36], 'Transformed capture needs a different recorder'
        if kind == 9:
            extent = struct.unpack_from('<ii', data, offset + 8)
        if kind == 10:
            origin = struct.unpack_from('<ii', data, offset + 8)
        if kind == 81:
            values = struct.unpack_from('<18i', data, offset + 8)
            info = data[offset + values[10]:offset + values[10] + values[11]]
            bits = data[offset + values[12]:offset + values[12] + values[13]]
            depth = struct.unpack_from('<H', info, 14)[0]
            if depth > 1:
                assert depth in [8, 16, 24] and values[6:8] == (0, 0)
                bmp = b'BM' + struct.pack('<IHHI', 14 + len(info) + len(bits), 0, 0, 14 + len(info)) + info + bits
                image = Image.open(BytesIO(bmp)).convert('RGB')
                assert image.size == tuple(values[16:18]) == tuple(values[8:10])
                images.append((values, np.asarray(image)))
        offset += size
    assert extent == (5100, 6600) and origin == (0, 0) and len(images) == 1
    assert capture['widthPt'] == 612 and capture['heightPt'] == 792
    values, pixels = images[0]
    if capture['page'] == 1 and (folder / 'wall-interior.json').exists():
        interior = json.loads((folder / 'wall-interior.json').read_text())
        for x, y, *rgb in interior['samples']:
            ix = round(x / .12 - values[4] - .5)
            iy = round(y / .12 - values[5] - .5)
            assert abs((values[4] + ix + .5) * .12 - x) < .00001
            assert abs((values[5] + iy + .5) * .12 - y) < .00001
            assert list(pixels[iy, ix]) == rgb
    for threshold, record in measured['thresholds'].items():
        ys, xs = np.nonzero(pixels.min(axis=2) < int(threshold))
        bounds = [round((values[4] + xs.min()) * .12, 4), round((values[5] + ys.min()) * .12, 4),
                  round((values[4] + xs.max() + 1) * .12, 4), round((values[5] + ys.max() + 1) * .12, 4)] if len(xs) else None
        assert bounds == record['native'], (capture['page'], threshold, bounds, record['native'])
print('Verified 10 native captures, 60 threshold bounds and retained wall RGB samples')
