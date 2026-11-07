"""Record authored mask controls from original native SVG metafile PNGs.

Avoid PDF's extra premultiplication of transparent RGB when testing mask alpha.
Usage: python tools/record_svg_masks.py <owned first-inline-range.emf>
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
fixture = sys.argv[2] if len(sys.argv)>2 else 'svg-masks'
matrix_fixtures = ['svg-mask-quantization','svg-mask-intermediate','svg-mask-quantization-boundary','svg-mask-intermediate-boundary']
assert fixture in ['svg-masks','svg-mask-edges','svg-mask-opacity','svg-mask-opacity-expanded','svg-mask-opacity-intermediate','svg-mask-opacity-expanded-intermediate','svg-image-masks','svg-image-masks-scaled','svg-image-masks-step','svg-mask-composition','svg-mask-composition-intermediate','svg-group-rectangle-edges','svg-mask-nested','svg-mask-nested-intermediate','svg-mask-luminance-coefficients'] + matrix_fixtures + ['svg-mask-opaque','svg-mask-opaque-intermediate','svg-group-composition','svg-group-composition-chains']
folder = root / 'tests/fixtures' / fixture
folder.mkdir(exist_ok=True)
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
            assert length >= 12 and offset + length <= position + size and count <= length - 12
            payload = native[offset+12:offset+12+count]
            if kind == 0x402A:
                transform = list(struct.unpack('<6f', payload))
            elif kind == 0x4008 and (flags >> 8) & 127 == 5:
                assert not flags & 0x8000, 'Unexpected continued image'
                assert struct.unpack_from('<II', payload)[1] == 1
                assert payload[28:36] == b'\x89PNG\r\n\x1a\n'
                data = payload[28:]
                name = f'native-mask-{len(images)+1}.png'
                (folder / name).write_bytes(data)
                im = Image.open(BytesIO(data)).convert('RGBA')
                images.append({'path': name, 'sha256': sha256(data).hexdigest(),
                    'size': list(im.size), 'transform': transform,
                    'middleColumn': [list(im.getpixel((im.width//2,y))) for y in range(im.height)]})
            offset += length
    position += size
assert len(images) == (36 if fixture in matrix_fixtures else 6), 'Expected one native raster for each independent mask control'
record = {'referenceBuild': '16.0.20326', 'captureSha256': sha256(capture).hexdigest(),
    'sourceSha256': sha256((root/'public/fixtures'/(fixture+'.docx')).read_bytes()).hexdigest(),
    'nativeSha256': sha256(native).hexdigest(), 'images': images}
(folder/'metafile-reference.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps([{k:v for k,v in image.items() if k!='middleColumn'} for image in images],indent=2))
