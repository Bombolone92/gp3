"""Recheck native texture statistics using only lossless bounded GDI bitmaps."""
from pathlib import Path
from io import BytesIO
from hashlib import sha256
import gzip
import struct
import json
import sys
import numpy as np
from PIL import Image

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/picture-3d-sampling'
ref = json.loads((folder / 'native.json').read_text())
assert sha256((folder / 'control.docx').read_bytes()).hexdigest() == ref['capture']['sourceSha256']
for capture, case in zip(ref['capture']['captures'], ref['cases'], strict=True):
    data = gzip.decompress((folder / (capture['file'] + '.gz')).read_bytes())
    assert sha256(data).hexdigest() == capture['sha256']
    offset = 0
    images = []
    extent = origin = None
    while offset < len(data):
        kind, size = struct.unpack_from('<II', data, offset)
        assert size >= 8 and size % 4 == 0 and offset + size <= len(data)
        assert kind not in [11, 12, 35, 36], 'Transformed page requires another recorder'
        if kind == 9:
            extent = struct.unpack_from('<ii', data, offset + 8)
        if kind == 10:
            origin = struct.unpack_from('<ii', data, offset + 8)
        if kind == 81:
            v = struct.unpack_from('<18i', data, offset + 8)
            info = data[offset + v[10]:offset + v[10] + v[11]]
            bits = data[offset + v[12]:offset + v[12] + v[13]]
            depth = struct.unpack_from('<H', info, 14)[0]
            if depth > 1:
                assert depth in [4, 8, 16, 24] and v[6:8] == (0, 0)
                header = b'BM' + struct.pack('<IHHI', 14 + len(info) + len(bits), 0, 0, 14 + len(info))
                image = Image.open(BytesIO(header + info + bits)).convert('RGB')
                assert image.size == tuple(v[16:18]) == tuple(v[8:10])
                images.append((v, image))
        offset += size
    assert extent == (5100, 6600) and origin == (0, 0) and len(images) == 1
    assert capture['widthPt'] == 612 and capture['heightPt'] == 792
    v, image = images[0]
    page = Image.new('RGB', extent, 'white')
    page.paste(image, tuple(v[4:6]))
    page = page.resize((2448, 3168), Image.Resampling.LANCZOS)
    l, t, r, b = [round(p * 4) for p in ref['regionPt']]
    pixels = np.asarray(page)[t:b, l:r]
    assert abs(float(pixels.mean()) - case['nativeMean']) < .00000001
    assert abs(float(pixels.std()) - case['nativeStd']) < .00000001
    raw = pixels.tobytes()
    roi = folder / (capture['file'] + '.rgb.gz')
    if '--record-rois' in sys.argv:
        roi.write_bytes(gzip.compress(raw, mtime=0))
        case['nativeRgbSha256'] = sha256(raw).hexdigest()
    else:
        assert gzip.decompress(roi.read_bytes()) == raw
        assert sha256(raw).hexdigest() == case['nativeRgbSha256']
if '--record-rois' in sys.argv:
    (folder / 'native.json').write_text(json.dumps(ref, indent=2) + '\n')
print('Verified six native texture fields, source hashes and exact raster mapping')
