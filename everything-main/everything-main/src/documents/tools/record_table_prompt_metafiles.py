"""Record the authored six-case table label control's bounded native evidence.

This is not an arbitrary EMF renderer, a font reader, or a page-position oracle.
Coordinates remain range-local; the physical frame rounds to hundredths of mm.
"""
from pathlib import Path
import hashlib
import json
import struct
from inspect_emf_text_records import inspect

FOLDER = Path(__file__).resolve().parents[1] / 'tests/fixtures/table-prompt-metrics'


def state_comment(record):
    # The native dual-mode envelope contains settings, GetDC and an identity reset,
    # but no EMF+ ink. Do not silently overlook another rendering/text stream.
    if len(record) < 16 or record[12:16] != b'EMF+' or struct.unpack_from('<I', record, 8)[0] != len(record) - 12:
        raise ValueError('Unexpected native comment')
    offset = 16
    while offset < len(record):
        if offset + 12 > len(record):
            raise ValueError('Truncated EMF+ state')
        kind, flags, size, payload = struct.unpack_from('<HHII', record, offset)
        if size < 12 or size % 4 or size != payload + 12 or offset + size > len(record):
            raise ValueError('Invalid EMF+ state size')
        if kind in (0x4002, 0x4004, 0x401E, 0x4021, 0x4022, 0x4024):
            if payload:
                raise ValueError('Unexpected EMF+ settings payload')
        elif kind == 0x4001:
            if flags != 1 or payload != 16:
                raise ValueError('Expected dual-mode header')
        elif kind == 0x4030:
            if flags != 2 or payload != 4 or struct.unpack_from('<f', record, offset + 12)[0] != 1:
                raise ValueError('Unexpected page transform')
        elif kind == 0x402A:
            if payload != 24 or struct.unpack_from('<6f', record, offset + 12) != (1, 0, 0, 1, 0, 0):
                raise ValueError('Unexpected world transform')
        else:
            raise ValueError('EMF+ drawing is outside this reference')
        offset += size


def label_record(data, *, top_rectangle=(8, 0, 367, 8), left_rectangle=(0, 8, 8, 292)):
    rows = inspect(data, include_italic=True)
    offset, extent, align, rectangles, count = 0, None, None, [], 0
    allowed = {1, 9, 10, 13, 14, 18, 22, 24, 25, 30, 33, 34, 37, 39, 40, 70, 76, 82, 84}
    while offset < len(data):
        kind, size = struct.unpack_from('<II', data, offset)
        if kind not in allowed:
            raise ValueError('Unexpected mapping or drawing record')
        if kind == 1:
            if offset or size < 88 or struct.unpack_from('<I', data, 40)[0] != 0x464D4520:
                raise ValueError('Invalid EMF header')
        elif offset == 0:
            raise ValueError('Missing EMF header')
        if kind == 10 and (size < 16 or struct.unpack_from('<2i', data, offset + 8) != (0, 0)):
            raise ValueError('Nonzero window origin')
        if kind == 9:
            if size < 16:
                raise ValueError('Truncated extent')
            current = struct.unpack_from('<2i', data, offset + 8)
            if extent and current != extent:
                raise ValueError('Varying extent')
            extent = current
        if kind == 22:
            if size < 12:
                raise ValueError('Truncated alignment')
            align = struct.unpack_from('<I', data, offset + 8)[0]
            if align != 24:
                raise ValueError('Expected left/baseline alignment')
        if kind == 84 and align != 24:
            raise ValueError('Missing baseline alignment')
        if kind == 70:
            state_comment(data[offset:offset + size])
        if kind == 76:
            if size != 100 or struct.unpack_from('<I', data, offset + 40)[0] != 0xF00021:
                raise ValueError('Expected border PATCOPY rectangle')
            if any(struct.unpack_from('<4I', data, offset + 84)):
                raise ValueError('Embedded bitmap is outside this reference')
            rectangles.append(list(struct.unpack_from('<4i', data, offset + 24)))
        if kind == 14 and offset + size != len(data):
            raise ValueError('Records follow EOF')
        count += 1
        offset += size
    if kind != 14 or struct.unpack_from('<2I', data, 48) != (len(data), count):
        raise ValueError('Invalid EMF length or record count')
    frame = struct.unpack_from('<4i', data, 24)
    if not extent or min(extent) <= 0 or frame[:2] != (0, 0) or min(frame[2:]) <= 0:
        raise ValueError('Unexpected native range frame')
    labels = [r for r in rows if r['text'] == 'W:']
    if len(labels) != 1:
        raise ValueError('Expected one independently authored label')
    label = labels[0]
    if label['font'] != dict(height=-150, width=0, escapement=0, orientation=0,
                             weight=700, face='Arial', italic=False):
        raise ValueError('Unexpected native reference font')
    if label['advanceDimensions'] != 1 or label['advances'] != [141, 51] or label['options'] != 4:
        raise ValueError('Unexpected label advances or clipping')
    if list(top_rectangle) not in rectangles or left_rectangle is not None and list(left_rectangle) not in rectangles:
        raise ValueError('Missing first-cell border geometry')
    return dict(logicalOrigin=label['logicalOrigin'], advances=label['advances'],
                font=label['font'], frameHundredthMm=list(frame), windowExtent=list(extent),
                logicalUnitPtByAxis=[frame[i + 2] / 2540 * 72 / extent[i] for i in range(2)],
                firstCellBorderCenter=[left_rectangle[0] + left_rectangle[2] / 2 if left_rectangle else None,
                                       top_rectangle[1] + top_rectangle[3] / 2], borderRectangles=rectangles)


def record(folder=FOLDER):
    capture = json.loads((folder / 'native-capture.json').read_text(encoding='utf-8-sig'))
    source_hash = hashlib.sha256((folder / 'control.docx').read_bytes()).hexdigest()
    if capture['sourceSha256'] != source_hash or capture['sourceUnchanged'] is not True or capture['saved'] is not True:
        raise ValueError('Unbound or modified native source')
    if (capture['tables'], capture['controls']) != (6, 4):
        raise ValueError('Unexpected source structure')
    cases = json.loads((folder / 'cases.json').read_text())
    expected = [(f, c) for f in ('style', 'direct') for c in ('plain', 'temporary', 'persistent')]
    if [(c['formatting'], c['control']) for c in cases] != expected or [c['page'] for c in cases] != list(range(1, 7)):
        raise ValueError('Unexpected isolation cases')
    names = ['control.docx', 'cases.json', 'native-capture.json']
    native = []
    for i, case in enumerate(cases, 1):
        name = f'native-table-{i}.emf'
        names.append(name)
        native.append(dict(**case, **label_record((folder / name).read_bytes())))
    return dict(referenceVersion=capture['version'], referenceBuild=capture['build'],
                method=capture['method'], coordinateScope='Detached table range; no page translation inferred',
                hashes={n: hashlib.sha256((folder / n).read_bytes()).hexdigest() for n in names}, cases=native)


if __name__ == '__main__':
    (FOLDER / 'native-reference.json').write_text(json.dumps(record(), indent=2) + '\n', encoding='utf-8')
    print('Recorded six source-bound native label and border observations')
