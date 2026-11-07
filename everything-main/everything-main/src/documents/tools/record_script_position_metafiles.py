"""Extract the bounded SPos controls; never interpret arbitrary EMF as a page.

GDI verification reselects each captured LOGFONT using a process-private copy
of the corresponding original OFL font. It verifies resolution now, not a
retrospective dump of the selected native font bytes at capture time.
"""
import argparse
import ctypes as C
import hashlib
import json
import struct
from pathlib import Path
from inspect_emf_text_records import inspect

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/script-position-metrics'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def capture(data, case, *, quantized_frame=False, zero_subscript_offset=False):
    rows = inspect(data, include_italic=True)
    face_style = case.get('face', 'regular')
    assert face_style in ('regular', 'bold', 'italic')
    offset, extent, alignment, descriptions = 0, None, None, {}
    plus_header, gdi_active = False, False
    allowed = {1, 9, 10, 14, 18, 22, 24, 37, 40, 70, 82, 84}
    while offset < len(data):
        kind, size = struct.unpack_from('<II', data, offset)
        record = data[offset:offset + size]
        if kind not in allowed:
            raise ValueError(f'Unexpected record {kind}; mapping not established')
        if kind == 70:
            length = struct.unpack_from('<I', record, 8)[0]
            assert record[12:16] == b'EMF+' and length + 12 == size
            position = 16
            while position < size:
                typ, flags, n, payload = struct.unpack_from('<HHII', record, position)
                assert n >= 12 and n % 4 == 0 and position + n <= size and payload == n - 12
                body = record[position + 12:position + n]
                gdi_active = False
                if typ == 0x4001:
                    assert not plus_header and flags == 1 and len(body) == 16
                    assert struct.unpack_from('<2I', body, 8) == (600, 600)
                    plus_header = True
                elif typ == 0x4004:
                    assert plus_header and flags == 0 and not body
                    gdi_active = True
                elif typ in (0x4022, 0x401e, 0x4024, 0x4021):
                    assert not body  # Rendering quality settings, not geometry.
                elif typ == 0x4030:
                    assert flags == 2 and struct.unpack('<f', body) == (1.0,)
                elif typ == 0x402a:
                    assert flags == 0 and struct.unpack('<6f', body) == (1, 0, 0, 1, 0, 0)
                elif typ == 0x4002:
                    assert flags == 0 and not body
                else:
                    raise ValueError(f'Unsupported EMF+ record {typ:#x}')
                position += n
        if kind == 10 and struct.unpack_from('<2i', record, 8) != (0, 0):
            raise ValueError('Nonzero window origin')
        if kind == 9:
            current = struct.unpack_from('<2i', record, 8)
            if extent and current != extent:
                raise ValueError('Changing window extent')
            extent = current
        if kind == 22:
            alignment = struct.unpack_from('<I', record, 8)[0]
            if alignment != 24:
                raise ValueError('Expected left/baseline alignment')
        if kind == 84 and (alignment != 24 or not gdi_active):
            raise ValueError('Text has no established baseline alignment')
        if kind == 82:
            raw = record[12:104]
            face = raw[28:].decode('utf-16-le').split('\0')[0]
            height = struct.unpack_from('<i', raw)[0]
            if face == case['family'] and height < 0 and bool(raw[20]) == (face_style == 'italic'):
                descriptions[height] = raw
        offset += size
    frame = struct.unpack_from('<4i', data, 24)
    assert extent and min(extent) > 0 and frame[:2] == (0, 0)
    scale = frame[2] / 2540 * 72 / extent[0]
    # The vertical .01mm frame edge is rounded. Use the exact horizontal
    # 600-unit/inch mapping only after checking isotropy within that rounding.
    assert abs(scale - .12) < 1e-12
    # A frame edge is in .01 mm, while the window extent is an integer
    # logical unit. Independently rounding both can differ by half a logical
    # unit plus half a frame unit. Older controls retain their stricter bound.
    frame_tolerance = scale / 72 * 2540 / 2 + .5 if quantized_frame else 1
    assert abs(frame[3] - extent[1] * scale / 72 * 2540) <= frame_tolerance
    label = case['family'] + (' ' + case['face'] if 'face' in case else '')
    assert len(rows) == 2 + len(case['rows']) * 5 and rows[0]['text'] == label
    result = []
    for index, source in enumerate(case['rows']):
        start, script, space, end, mark = rows[2 + index * 5:7 + index * 5]
        assert [r['text'] for r in [start, script, space, end, mark]] == ['START ', 'TEST', ' ', 'END', ' ']
        baseline = start['logicalOrigin'][1]
        assert all(r['logicalOrigin'][1] == baseline for r in [space, end, mark])
        assert start['logicalOrigin'][0] == 0
        for row in [start, script, space, end]:
            font = row['font']
            assert font['face'] == case['family']
            assert font['italic'] == (face_style == 'italic')
            assert all(font[k] == 0 for k in ['width', 'escapement', 'orientation'])
            assert font['weight'] == (700 if face_style == 'bold' else 400) and row['advanceDimensions'] == 1
            assert row['options'] == 4 and len(row['advances']) == len(row['text'])
        for left, right in zip([start, script, space], [script, space, end]):
            assert left['logicalOrigin'][0] + sum(left['advances']) == right['logicalOrigin'][0]
        assert start['font']['height'] == -round(source['size'] / scale)
        rise = baseline - script['logicalOrigin'][1]
        assert rise > 0 if source['script'] == 'superscript' else (rise == 0 if zero_subscript_offset else rise < 0)
        result.append(dict(**source, normalHeight=start['font']['height'],
                           scriptHeight=script['font']['height'], riseLogical=rise,
                           risePt=round(rise * scale, 8)))
    return dict(logicalUnitPt=scale, rows=result), descriptions


def verify_gdi(font_bytes, descriptions):
    gdi = C.WinDLL('gdi32', use_last_error=True)
    ptr, u, i = C.c_void_p, C.c_uint32, C.c_int32

    def api(name, args, result):
        f = getattr(gdi, name)
        f.argtypes, f.restype = args, result
        return f

    add = api('AddFontMemResourceEx', [ptr, u, ptr, C.POINTER(u)], ptr)
    remove = api('RemoveFontMemResourceEx', [ptr], i)
    dcnew = api('CreateCompatibleDC', [ptr], ptr)
    dcdel = api('DeleteDC', [ptr], i)
    fontnew = api('CreateFontIndirectW', [ptr], ptr)
    select = api('SelectObject', [ptr, ptr], ptr)
    delete = api('DeleteObject', [ptr], i)
    fontdata = api('GetFontData', [ptr, u, u, ptr, u], u)
    tables = {font_bytes[p:p + 4]: struct.unpack_from('>II', font_bytes, p + 8)
              for p in range(12, 12 + 16 * struct.unpack_from('>H', font_bytes, 4)[0], 16)}
    buffer, count = C.create_string_buffer(font_bytes), u()
    resource = add(buffer, len(font_bytes), None, C.byref(count))
    assert resource and count.value
    dc, result = None, []
    try:
        dc = dcnew(None)
        assert dc
        for height, raw in sorted(descriptions.items()):
            font = fontnew(C.create_string_buffer(raw))
            assert font
            old = select(dc, font)
            try:
                verified = {}
                for tag, (offset, length) in tables.items():
                    selected = C.create_string_buffer(length)
                    assert fontdata(dc, int.from_bytes(tag, 'little'), 0, selected, length) == length
                    assert selected.raw == font_bytes[offset:offset + length], tag
                    verified[tag.decode()] = sha(selected.raw)
                result.append(dict(logicalHeight=height, tables=verified))
            finally:
                select(dc, old)
                delete(font)
    finally:
        if dc:
            dcdel(dc)
        assert remove(resource)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-gdi', action='store_true', help='Windows: verify every selected font table')
    parser.add_argument('--output', type=Path, default=ROOT / 'emf-reference.json')
    args = parser.parse_args()
    cases = json.loads((ROOT / 'cases.json').read_text())
    assert len(cases) == 14
    names = ['controls.docx', 'cases.json', 'fonts.json']
    results = []
    for index, case in enumerate(cases, 1):
        name = f'native-font-{index}.emf'
        font = case['family'].replace(' ', '') + '.ttf'
        native, descriptions = capture((ROOT / name).read_bytes(), case)
        row = dict(family=case['family'], mode=case['mode'], variant=case['variant'], **native)
        if args.verify_gdi:
            row['reselectedFontTables'] = verify_gdi((ROOT / font).read_bytes(), descriptions)
        results.append(row)
        names.extend([name, font])
        print(case['family'], [r['risePt'] for r in native['rows']])
    reference = dict(referenceBuild='16.0.20326', capture='Range.EnhMetaFileBits',
                     hashes={n: sha((ROOT / n).read_bytes()) for n in names}, cases=results)
    args.output.write_text(json.dumps(reference, indent=2) + '\n', encoding='utf-8')
    print('Verified 56 native positions; font-table reselection:', args.verify_gdi)


if __name__ == '__main__':
    main()
