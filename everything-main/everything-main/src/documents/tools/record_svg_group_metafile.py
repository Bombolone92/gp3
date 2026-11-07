"""Extract native raster strips and placements from the owned reference capture.

Usage: python tools/record_svg_group_metafile.py <outer-range.emf>
MS-EMFPLUS image, transform and DrawImagePoints records provide the evidence.
"""
from pathlib import Path
from hashlib import sha256
from io import BytesIO
import json
import struct
import sys
from PIL import Image
from extract_svg_viewport_metafiles import extract

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures' / (sys.argv[2] if len(sys.argv)>2 else 'svg-group-raster')
folder.mkdir(parents=True, exist_ok=True)
capture = Path(sys.argv[1]).read_bytes()
native = extract(capture)
(folder / 'native.emf').write_bytes(native)
position = 0
images = []
transform = [1, 0, 0, 1, 0, 0]
while position < len(native):
    kind, size = struct.unpack_from('<II', native, position)
    assert size >= 8 and position + size <= len(native)
    if kind == 70 and native[position+12:position+16] == b'EMF+':
        offset = position + 16
        while offset < position + size:
            kind, flags, length, count = struct.unpack_from('<HHII', native, offset)
            assert length >= 12 and count <= length - 12
            payload = native[offset+12:offset+12+count]
            if kind == 0x402A:
                transform = list(struct.unpack('<6f', payload))
            elif kind == 0x4008 and (flags >> 8) & 127 == 5:
                assert not flags & 0x8000, 'Continued image not present in these controls'
                version, image_type = struct.unpack_from('<II', payload)
                assert image_type == 1 and payload[28:36] == b'\x89PNG\r\n\x1a\n'
                name = f'native-strip-{len(images)+1}.png'
                # Preserve the embedded PNG, not a PDF conversion of its colors.
                data = payload[28:]
                (folder / name).write_bytes(data)
                im = Image.open(BytesIO(data)).convert('RGBA')
                images.append({'path': name, 'sha256': sha256(data).hexdigest(),
                               'size': list(im.size), 'transform': transform,
                               'middleColumn': [list(im.getpixel((im.width//2,y))) for y in range(im.height)]})
            offset += length
    position += size
assert len(images) == 4
data = {'referenceBuild': '16.0.20326', 'captureSha256': sha256(capture).hexdigest(),
        'sourceSha256': sha256((root / 'public/fixtures' / (folder.name+'.docx')).read_bytes()).hexdigest(),
        'nativeSha256': sha256(native).hexdigest(), 'images': images}
(folder / 'metafile-reference.json').write_text(json.dumps(data, indent=2)+'\n', encoding='utf-8')
