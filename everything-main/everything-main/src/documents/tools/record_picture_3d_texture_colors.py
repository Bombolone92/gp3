"""Verify original source, native page mapping and full-color EMF+ playback fields."""
from pathlib import Path
from hashlib import sha256
import gzip
import json
import struct
import sys
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/picture-3d-textures'
folder = root / 'device'
capture = json.loads((folder / 'capture.json').read_text(encoding='utf-8-sig'))
old = json.loads((root / 'reference.json').read_text())
assert sha256((root / 'control.docx').read_bytes()).hexdigest() == capture['sourceSha256'] == old['sourceSha256']
assert capture['sourceUnchanged'] and capture['savedBefore'] and capture['savedAfter']
assert len(capture['captures']) == len(old['cases']) == 8
cases = []
for entry, case in zip(capture['captures'], old['cases'], strict=True):
    data = gzip.decompress((folder / (entry['file'] + '.gz')).read_bytes())
    assert sha256(data).hexdigest() == entry['sha256'] and len(data) == entry['length']
    assert entry['widthPt'] == 612 and entry['heightPt'] == 792
    assert struct.unpack_from('<I', data, 48)[0] == len(data)
    offset = records = 0
    extents, origins, plus_headers = [], [], []
    while offset < len(data):
        kind, size = struct.unpack_from('<II', data, offset)
        assert size >= 8 and size % 4 == 0 and offset + size <= len(data)
        assert kind not in (11, 12, 35, 36), 'Unexpected GDI page transformation'
        if kind == 9:
            extents.append(struct.unpack_from('<ii', data, offset + 8))
        elif kind == 10:
            origins.append(struct.unpack_from('<ii', data, offset + 8))
        elif kind == 70:
            count = struct.unpack_from('<I', data, offset + 8)[0]
            assert count <= size - 12
            end = offset + 12 + count
            if data[offset + 12:offset + 16] == b'EMF+':
                p = offset + 16
                while p < end:
                    typ, flags, length, payload = struct.unpack_from('<HHII', data, p)
                    assert length >= 12 and length % 4 == 0 and p + length <= end and payload <= length - 12
                    if typ == 0x4001:
                        assert payload == 16 and flags == 1
                        plus_headers.append(struct.unpack_from('<II', data, p + 20))
                    p += length
                assert p == end
        records += 1
        offset += size
    assert records == struct.unpack_from('<I', data, 52)[0]
    assert extents and set(extents) == {(5100, 6600)} and origins and set(origins) == {(0, 0)}
    assert plus_headers == [(600, 600)]
    png = folder / (Path(entry['file']).stem + '.png')
    image = Image.open(png).convert('RGB')
    assert image.size == (2448, 3168)
    samples = [{'xPt':s['xPt'], 'yPt':s['yPt'], 'rgb':list(image.getpixel((round(s['xPt'] * 4), round(s['yPt'] * 4))))} for s in case['samples']]
    cases.append({'name':case['name'], 'png':png.name, 'pngSha256':sha256(png.read_bytes()).hexdigest(), 'samples':samples})
result = {'sourceSha256':capture['sourceSha256'], 'referenceBuild':capture['referenceBuild'], 'pixelsPerPoint':4,
          'method':'Windows GDI+ EMF+ dual playback with explicit 5100 x 6600 logical page source rectangle', 'cases':cases}
target = folder / 'reference.json'
if '--record' in sys.argv:
    target.write_text(json.dumps(result, indent=2) + '\n')
else:
    assert json.loads(target.read_text()) == result
print('Verified eight hash-bound full-color EMF+ playback fields and logical page mapping')
