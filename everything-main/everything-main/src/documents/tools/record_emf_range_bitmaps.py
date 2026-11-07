"""Read compressed image evidence from native reference Range.EnhMetaFileBits.

This is an evidence reader, not document playback. MS-EMFPLUS 2.2.1.4,
2.2.2.2, 2.2.2.10 and 2.3.4.9 define the fields read here. Compressed
bitmap dimensions come from PNG, never the undefined bitmap header fields.
Continued objects and relative point encoding are rejected rather than guessed.
"""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import json
import struct
import sys
from PIL import Image

def require(condition, message):
    if not condition:
        raise ValueError(message)

def extract(data):
    require(len(data) >= 88, 'Truncated EMF header')
    require(struct.unpack_from('<I', data)[0] == 1 and data[40:44] == b' EMF', 'Invalid EMF signature')
    require(struct.unpack_from('<I', data, 48)[0] == len(data), 'Incorrect EMF byte count')
    position = 0
    records = 0
    images = []
    objects = {}
    while position < len(data):
        require(position + 8 <= len(data), 'Truncated record header')
        kind, size = struct.unpack_from('<II', data, position)
        require(size >= 8 and size % 4 == 0 and position + size <= len(data), 'Invalid record length')
        if kind == 70:
            require(size >= 12, 'Truncated comment')
            comment_size = struct.unpack_from('<I', data, position+8)[0]
            require(comment_size <= size-12, 'Comment extends beyond record')
            end = position + 12 + comment_size
            if data[position+12:position+16] == b'EMF+':
                offset = position+16
                while offset < end:
                    require(offset+12 <= end, 'Truncated EMF+ header')
                    record, flags, length, count = struct.unpack_from('<HHII', data, offset)
                    require(length >= 12 and length % 4 == 0 and offset+length <= end and count <= length-12, 'Invalid EMF+ length')
                    payload = data[offset+12:offset+12+count]
                    object_id = flags & 255
                    if record == 0x4008:
                        # Replacing an object-table slot invalidates its old image.
                        objects.pop(object_id, None)
                        if (flags >> 8) & 127 == 5:
                            require(not flags & 0x8000, 'Continued image not supported by evidence reader')
                            require(count >= 8, 'Truncated image')
                            image_type = struct.unpack_from('<I', payload, 4)[0]
                            if image_type == 1:
                                require(count >= 28 and struct.unpack_from('<I', payload, 24)[0] == 1, 'Expected compressed bitmap')
                                png = payload[28:]
                                require(png.startswith(b'\x89PNG\r\n\x1a\n'), 'Expected PNG compressed image')
                                image = Image.open(BytesIO(png))
                                image.verify()
                                image = Image.open(BytesIO(png)).convert('RGBA')
                                entry = dict(objectId=object_id, pngSha256=sha256(png).hexdigest(),
                                             rgbaSha256=sha256(image.tobytes()).hexdigest(), size=list(image.size), draws=[])
                                images.append(entry)
                                objects[object_id] = entry
                    elif record == 0x401b and object_id in objects:
                        require(count >= 28 and struct.unpack_from('<I', payload, 4)[0] == 2, 'Expected pixel source units')
                        require(not flags & 0x800, 'Relative points not supported by evidence reader')
                        require(struct.unpack_from('<I', payload, 24)[0] == 3, 'Expected three destination points')
                        compressed = bool(flags & 0x4000)
                        require(count == (40 if compressed else 52), 'Incorrect point payload length')
                        points = struct.unpack_from('<6h' if compressed else '<6f', payload, 28)
                        objects[object_id]['draws'].append(dict(sourceRect=list(struct.unpack_from('<4f', payload, 8)),
                                                              points=[list(points[i:i+2]) for i in range(0,6,2)]))
                    offset += length
        records += 1
        position += size
    require(records == struct.unpack_from('<I', data, 52)[0], 'Incorrect record count')
    return dict(device=list(struct.unpack_from('<4i', data, 72)), images=images)

def record(capture, fixture):
    data = capture.read_bytes()
    provenance = json.loads(Path(str(capture)+'.json').read_text(encoding='utf-8-sig'))
    pdf = json.loads((fixture/'reference.json').read_text())
    require(sha256(data).hexdigest() == provenance['captureSha256'], 'Capture hash mismatch')
    require(sha256((fixture/'control.docx').read_bytes()).hexdigest() == provenance['sourceSha256'] == pdf['sourceSha256'], 'Source hash mismatch')
    require(sha256((fixture/'native.pdf').read_bytes()).hexdigest() == pdf['pdfSha256'], 'PDF hash mismatch')
    require(provenance['sourceUnchanged'] is True, 'Source preservation not established')
    result = extract(data)
    require(len(result['images']) == len(pdf['nativeImages']) == 4, 'Expected four paired rows')
    for entry, native in zip(result['images'], pdf['nativeImages']):
        png = (fixture/native['file']).read_bytes()
        require(sha256(png).hexdigest() == native['sha256'], 'PDF image hash mismatch')
        entry['pdfSize'] = list(Image.open(BytesIO(png)).size)
    return dict(provenance=provenance, pdfSha256=pdf['pdfSha256'], **result)

if __name__ == '__main__':
    capture, fixture, output = map(Path, sys.argv[1:])
    output.write_bytes((json.dumps(record(capture, fixture), indent=2)+'\n').encode('utf-8'))
