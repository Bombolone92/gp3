"""Verify retained native captures and both explicitly named playback policies."""
from pathlib import Path
from hashlib import sha256
import gzip
import json
import struct
import sys
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/picture-3d-uv-mapping'
roi = (600, 780, 900, 1060)
result = {'regionPx': list(roi), 'pixelsPerPoint': 4, 'cases': []}
for kind, source, count in [('projected', 'control.docx', 5), ('plain', 'plain.docx', 1), ('left', 'left.docx', 1)]:
    folder = root / 'native' / kind
    capture = json.loads((folder / 'capture.json').read_text(encoding='utf-8-sig'))
    source_hash = sha256((root / source).read_bytes()).hexdigest()
    assert source_hash == capture['sourceSha256']
    assert capture['sourceUnchanged'] and capture['savedBefore'] and capture['savedAfter']
    assert len(capture['captures']) == count
    images = []
    for entry in capture['captures']:
        assert entry['file'] == f"page-{entry['page']}.emf"
        assert entry['widthPt'] == 612 and entry['heightPt'] == 792
        data = gzip.decompress((folder / (entry['file'] + '.gz')).read_bytes())
        assert len(data) == entry['length'] and sha256(data).hexdigest() == entry['sha256']
        assert struct.unpack_from('<I', data, 48)[0] == len(data)
        offset = records = 0
        extents, origins, headers = [], [], []
        while offset < len(data):
            typ, size = struct.unpack_from('<II', data, offset)
            assert size >= 8 and size % 4 == 0 and offset + size <= len(data)
            assert typ not in (11, 12, 35, 36), 'Unexpected page transformation'
            if typ == 9: extents.append(struct.unpack_from('<ii', data, offset + 8))
            if typ == 10: origins.append(struct.unpack_from('<ii', data, offset + 8))
            if typ == 70:
                n = struct.unpack_from('<I', data, offset + 8)[0]
                assert n <= size - 12
                end = offset + 12 + n
                if data[offset + 12:offset + 16] == b'EMF+':
                    p = offset + 16
                    while p < end:
                        plus, flags, length, payload = struct.unpack_from('<HHII', data, p)
                        assert length >= 12 and length % 4 == 0 and p + length <= end and payload <= length - 12
                        if plus == 0x4001:
                            assert payload == 16 and flags == 1
                            headers.append(struct.unpack_from('<II', data, p + 20))
                        p += length
                    assert p == end
            records += 1
            offset += size
        assert records == struct.unpack_from('<I', data, 52)[0]
        assert extents and set(extents) == {(5100, 6600)}
        assert origins and set(origins) == {(0, 0)} and headers == [(600, 600)]
        for mode in ['default', 'half']:
            name = f"{mode}-{entry['page']}.png"
            path = folder / name
            with Image.open(path) as image:
                assert image.size == (2448, 3168)
                crop = image.convert('RGBA').crop(roi)
                pixel_hash = sha256(crop.tobytes()).hexdigest()
            images.append({'page': entry['page'], 'mode': mode, 'file': name,
                           'sha256': sha256(path.read_bytes()).hexdigest(), 'regionRgbaSha256': pixel_hash})
    for mode in ['default', 'half']:
        if kind == 'projected':
            hashes = [i['regionRgbaSha256'] for i in images if i['mode'] == mode]
            assert hashes[0] == hashes[1] == hashes[2], 'Uniform fitting differs in the native reference'
            assert hashes[0] != hashes[3], 'Opposed extents must exercise a different fit'
    result['cases'].append({'kind': kind, 'source': source, 'sourceSha256': source_hash, 'images': images})
target = root / 'native/reference.json'
if '--record' in sys.argv:
    target.write_text(json.dumps(result, indent=2) + '\n')
else:
    assert json.loads(target.read_text()) == result
print('Verified seven unchanged native pages, both playback modes and uniform-fit equivalence')
