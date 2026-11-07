"""Audit retained owned mask PNGs at draw time, without playing any records.

MS-EMFPLUS 2.3.4.9, 2.3.6, 2.3.9. This bounded diagnostic rejects
unsupported transform/state encodings instead of assuming identity. It does
not replace native references or certify rendered pixels.
"""
import argparse
import json
import struct
from hashlib import sha256
from pathlib import Path
from emfplus_image_objects import png_bytes, require

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ['svg-mask-opacity', 'svg-mask-opacity-expanded', 'svg-mask-opaque',
            'svg-mask-luminance-coefficients', 'svg-mask-quantization',
            'svg-mask-quantization-boundary', 'svg-mask-composition',
            'svg-mask-nested', 'svg-image-masks', 'svg-image-masks-scaled',
            'svg-image-masks-step', 'svg-mask-edges']


def inspect(data):
    require(len(data) >= 88 and data[40:44] == b' EMF', 'Invalid EMF header')
    require(struct.unpack_from('<I', data, 48)[0] == len(data), 'EMF byte count')
    objects = {}; images = []; draws = []; position = 0; records = 0
    state = {'worldTransform': [1, 0, 0, 1, 0, 0], 'pageTransform': None,
             'interpolationMode': None, 'pixelOffsetMode': None,
             'compositingMode': None, 'compositingQuality': None, 'antiAliasMode': None}
    while position < len(data):
        require(position + 8 <= len(data), 'Truncated EMF record')
        kind, size = struct.unpack_from('<II', data, position)
        require(size >= 8 and size % 4 == 0 and position + size <= len(data), 'EMF record length')
        if kind == 70:
            require(size >= 12, 'Truncated comment')
            count = struct.unpack_from('<I', data, position + 8)[0]
            require(count <= size - 12, 'Comment size')
            end = position + 12 + count
            if data[position + 12:position + 16] == b'EMF+':
                offset = position + 16
                while offset < end:
                    require(offset + 12 <= end, 'Truncated EMF+ header')
                    tag, flags, length, n = struct.unpack_from('<HHII', data, offset)
                    require(length >= 12 and length % 4 == 0 and offset + length <= end and n <= length - 12, 'EMF+ length')
                    payload = data[offset + 12:offset + 12 + n]
                    # Clipping/path/brush payloads are not decoded. They remain
                    # outside this draw-state audit, as does the EMF fallback.
                    require(tag in {0x4001, 0x4002, 0x4008, 0x401b, 0x401e,
                                    0x4021, 0x4022, 0x4023, 0x4024, 0x402a,
                                    0x4030, 0x4032, 0x4034}, 'Unsupported state/record')
                    if tag == 0x4008:
                        slot, typ = flags & 255, flags >> 8 & 127
                        require(slot <= 63 and not flags & 0x8000, 'Unsupported object encoding')
                        require(typ in {1, 2, 3, 4, 5, 8}, 'Unsupported object, including font data')
                        objects.pop(slot, None)
                        if typ == 5:
                            png, dimensions = png_bytes(payload)
                            image = {'index': len(images), 'objectId': slot,
                                     'pngSha256': sha256(payload[28:]).hexdigest(),
                                     'pngWithoutPaddingSha256': sha256(png).hexdigest(), 'size': list(dimensions),
                                     'creationTransform': list(state['worldTransform'])}
                            images.append(image); objects[slot] = image
                        elif typ == 8:
                            require(n == 24, 'Image attribute length')
                            version, reserved, wrap, color, clamp, tail = struct.unpack('<6I', payload)
                            objects[slot] = {'wrapMode': wrap, 'clampColor': color, 'objectClamp': clamp}
                    elif tag == 0x402a:
                        require(n == 24, 'World transform length')
                        state['worldTransform'] = list(struct.unpack('<6f', payload))
                    elif tag == 0x4030:
                        require(n == 4, 'Page transform length')
                        state['pageTransform'] = {'unit': flags & 255, 'scale': struct.unpack('<f', payload)[0]}
                    elif tag == 0x401e:
                        require(n == 0, 'Anti-alias payload')
                        state['antiAliasMode'] = {'enabled': bool(flags & 1), 'mode': flags >> 1 & 127}
                    elif tag in {0x4021, 0x4022, 0x4023, 0x4024}:
                        require(n == 0, 'Property payload')
                        key = {0x4021: 'interpolationMode', 0x4022: 'pixelOffsetMode',
                               0x4023: 'compositingMode', 0x4024: 'compositingQuality'}[tag]
                        state[key] = flags & 255
                    elif tag == 0x401b:
                        slot = flags & 255
                        require(slot in objects and 'pngSha256' in objects[slot], 'Draw references missing image')
                        require(not flags & 0x800, 'Relative points unsupported')
                        compressed = bool(flags & 0x4000)
                        require(n == (40 if compressed else 52), 'Draw point length')
                        attr, unit = struct.unpack_from('<2I', payload)
                        require(unit == 2 and struct.unpack_from('<I', payload, 24)[0] == 3, 'Draw source unit/point count')
                        require(attr == 0xffffffff or attr in objects and 'wrapMode' in objects[attr], 'Missing image attributes')
                        points = struct.unpack_from('<6h' if compressed else '<6f', payload, 28)
                        draws.append({**objects[slot], **state,
                                      'sourceRect': list(struct.unpack_from('<4f', payload, 8)),
                                      'points': [list(points[i:i + 2]) for i in range(0, 6, 2)],
                                      'imageAttributes': None if attr == 0xffffffff else dict(objects[attr])})
                    offset += length
        position += size; records += 1
    require(records == struct.unpack_from('<I', data, 52)[0], 'EMF record count')
    return images, draws


def audit(name):
    folder = ROOT / 'tests/fixtures' / name
    ref = json.loads((folder / 'metafile-reference.json').read_text())
    data = (folder / 'native.emf').read_bytes()
    source = ROOT / 'public/fixtures' / (name + '.docx')
    require(sha256(source.read_bytes()).hexdigest() == ref['sourceSha256'], 'Source hash')
    require(sha256(data).hexdigest() == ref['nativeSha256'], 'Native hash')
    images, draws = inspect(data)
    require(len(images) == len(ref['images']) == len(draws), 'One draw per retained image required')
    for image, expected, draw in zip(images, ref['images'], draws):
        require(image['index'] == draw['index'], 'Image order differs from drawing order')
        require(sha256((folder / expected['path']).read_bytes()).hexdigest() == image['pngSha256'] == expected['sha256'], 'PNG hash')
        require(image['size'] == expected['size'], 'Image size')
        draw['legacyReferenceTransform'] = expected['transform']
    return {'fixture': name, 'sourceSha256': ref['sourceSha256'],
            'nativeSha256': ref['nativeSha256'], 'draws': draws}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    require(not args.output.exists(), 'Output exists; preserve prior evidence')
    rows = [audit(name) for name in FIXTURES]
    result = {'scope': 'Retained owned image draw-state audit only; clipping, fallback and device playback not reconstructed.', 'fixtures': rows}
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2); stream.write('\n')
    print('Audited', sum(len(row['draws']) for row in rows), 'draws in', len(rows), 'fixtures')


if __name__ == '__main__':
    main()
