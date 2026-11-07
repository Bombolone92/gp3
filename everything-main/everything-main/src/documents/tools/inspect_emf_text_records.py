"""Inspect Unicode GDI text/font records, not an EMF renderer or page mapper.

Logical origins and advances are retained without unit conversion. EMF+ text,
transforms, clipping, fallback fonts and physical page anchoring are not resolved.
"""
import argparse
import json
import struct
from pathlib import Path


def inspect(data, *, include_italic=False):
    offset, fonts, selected, stack, rows = 0, {}, None, [], []
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError('Truncated record header')
        kind, size = struct.unpack_from('<II', data, offset)
        if size < 8 or size % 4 or offset + size > len(data):
            raise ValueError('Invalid record size')
        record = data[offset:offset + size]
        if kind == 82:  # EMR_EXTCREATEFONTINDIRECTW
            if size < 104:
                raise ValueError('Truncated LOGFONTW')
            handle = struct.unpack_from('<I', record, 8)[0]
            height, width, escapement, orientation, weight = struct.unpack_from('<5i', record, 12)
            face = record[40:104].decode('utf-16-le').split('\0')[0]
            fonts[handle] = dict(height=height, width=width, escapement=escapement,
                                 orientation=orientation, weight=weight, face=face)
            if include_italic:
                fonts[handle]['italic'] = bool(record[32])
        elif kind == 37:  # EMR_SELECTOBJECT: brush/pen selections retain the font.
            handle = struct.unpack_from('<I', record, 8)[0]
            if handle in fonts:
                selected = fonts[handle]
            elif handle in [0x80000000 + n for n in (10, 11, 12, 13, 14, 16, 17)]:
                selected = None  # Stock font metrics are not recorded here.
        elif kind == 40:
            fonts.pop(struct.unpack_from('<I', record, 8)[0], None)
        elif kind == 33:
            stack.append(selected)
        elif kind == 34:
            level = struct.unpack_from('<i', record, 8)[0]
            if level >= 0 or -level > len(stack):
                raise ValueError('Unsupported or invalid RestoreDC level')
            selected, stack = stack[level], stack[:level]
        elif kind in (83, 96, 97, 108):
            raise ValueError('Unsupported text record: ' + str(kind))
        elif kind == 84:  # EMR_EXTTEXTOUTW
            if size < 76:
                raise ValueError('Truncated EMRTEXT')
            x, y, count, string, options = struct.unpack_from('<iiIII', record, 36)
            dx = struct.unpack_from('<I', record, 72)[0]
            dimensions = 2 if options & 0x2000 else 1
            if options & 0x10:
                raise ValueError('Glyph-index text is outside this inspector')
            if string < 76 or string + count * 2 > size or dx and (dx < 76 or dx + count * dimensions * 4 > size):
                raise ValueError('Invalid text/advance offsets')
            text = record[string:string + count * 2].decode('utf-16-le')
            advances = list(struct.unpack_from('<' + str(count * dimensions) + 'i', record, dx)) if dx else []
            rows.append(dict(text=text, font=selected, logicalOrigin=[x, y],
                             advances=advances, advanceDimensions=dimensions, options=options,
                             scale=list(struct.unpack_from('<2f', record, 28))))
        offset += size
    return rows


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(inspect(args.input.read_bytes()), indent=2) + '\n', encoding='utf-8')
