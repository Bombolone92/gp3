"""Verify horizontal adjacency in bounded reference script metafiles.

This recorder does not map their vertical frame to physical page coordinates.
It verifies font-table resolution by reselecting captured LOGFONT descriptions;
that is not a retrospective dump of the native font bytes during capture.
"""
from pathlib import Path
import hashlib
import json
import struct
from inspect_emf_text_records import inspect
from record_script_position_metafiles import verify_gdi

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'tests/fixtures/bundled-script'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    cases = json.loads((FOLDER / 'cases.json').read_text())
    captures = []
    for index, case in enumerate(cases):
        path = FOLDER / f'native-face-{index}.emf'
        data = path.read_bytes()
        rows = inspect(data, include_italic=True)
        assert len(rows) == 2 + 5 * len(case['rows'])
        assert rows[0]['text'] == case['family'] + ' ' + case['face']
        at, descriptions, extent, alignment = 0, {}, None, None
        plus_header, gdi_active = False, False
        while at < len(data):
            kind, size = struct.unpack_from('<II', data, at)
            record = data[at:at+size]
            assert kind in {1, 9, 10, 14, 18, 22, 24, 37, 40, 70, 82, 84}, kind
            if kind == 9:
                value = struct.unpack_from('<2i', record, 8)
                assert extent is None or value == extent
                extent = value
            if kind == 10:
                assert struct.unpack_from('<2i', record, 8) == (0, 0)
            if kind == 22:
                alignment = struct.unpack_from('<I', record, 8)[0]
                assert alignment == 24
            if kind == 84:
                assert alignment == 24 and plus_header and gdi_active
            if kind == 70:
                assert record[12:16] == b'EMF+'
                assert struct.unpack_from('<I', record, 8)[0] + 12 == size
                offset = 16
                while offset < size:
                    typ, flags, length, payload = struct.unpack_from('<HHII', record, offset)
                    assert length >= 12 and length % 4 == 0 and payload == length - 12
                    body = record[offset+12:offset+length]
                    assert offset + length <= size
                    assert typ in {0x4001, 0x4002, 0x4004, 0x4022, 0x401e, 0x4024, 0x4021, 0x4030, 0x402a}
                    gdi_active = False
                    if typ == 0x4001:
                        assert not plus_header and flags == 1 and len(body) == 16
                        assert struct.unpack_from('<2I', body, 8) == (600, 600)
                        plus_header = True
                    elif typ == 0x4004:
                        assert plus_header and flags == 0 and not body
                        gdi_active = True
                    elif typ in {0x4002, 0x4022, 0x401e, 0x4024, 0x4021}:
                        assert not body
                    if typ == 0x402a:
                        assert struct.unpack('<6f', body) == (1, 0, 0, 1, 0, 0)
                    if typ == 0x4030:
                        assert flags == 2 and struct.unpack('<f', body) == (1.0,)
                    offset += length
                assert offset == size
            if kind == 82:
                raw = record[12:104]
                if raw[28:].decode('utf-16-le').split('\0')[0] == case['family']:
                    descriptions[struct.unpack_from('<i', raw)[0]] = raw
            at += size
        frame = struct.unpack_from('<4i', data, 24)
        assert extent and frame[:2] == (0, 0)
        scale = frame[2] / 2540 * 72 / extent[0]
        assert abs(scale - .12) < 1e-12
        observed = []
        for i, authored in enumerate(case['rows']):
            start, script, space, end, mark = rows[2+i*5:7+i*5]
            assert [r['text'] for r in [start, script, space, end, mark]] == ['START ', 'TEST', ' ', 'END', ' ']
            for run in [start, script, space, end]:
                assert run['font']['face'] == case['family']
                assert run['font']['italic'] == (case['face'] == 'italic')
                assert run['font']['weight'] == (700 if case['face'] == 'bold' else 400)
                assert all(run['font'][k] == 0 for k in ['width', 'escapement', 'orientation'])
                assert run['options'] == 4 and run['advanceDimensions'] == 1
                assert len(run['advances']) == len(run['text'])
            prefix_end = start['logicalOrigin'][0] + sum(start['advances'])
            assert abs(-start['font']['height'] * scale - authored['size']) < .061
            assert script['font']['height'] < 0
            gap = script['logicalOrigin'][0] - prefix_end
            assert gap == 0
            assert script['logicalOrigin'][0] + sum(script['advances']) == space['logicalOrigin'][0]
            observed.append(dict(authored, prefixEndLogical=prefix_end,
                                 prefixAdvances=start['advances'],
                                 scriptLogicalHeight=script['font']['height'],
                                 nativeSizePt=-script['font']['height'] * scale,
                                 scriptOriginLogical=script['logicalOrigin'][0], horizontalGapLogical=gap))
        # An offset absorbed into the prefix's advances would still leave the
        # runs contiguous. The same prefix must also stay identical between
        # superscript and subscript, whose recommended italic X offsets differ.
        for i in range(0, len(observed), 2):
            left, right = observed[i:i+2]
            assert left['size'] == right['size']
            assert [left['script'], right['script']] == ['superscript', 'subscript']
            assert left['prefixAdvances'] == right['prefixAdvances']
            assert left['scriptOriginLogical'] == right['scriptOriginLogical']
        font_path = ROOT / 'public/fonts' / ('NotoSans-Italic.ttf' if case['face'] == 'italic' else 'NotoSans.ttf')
        selected = verify_gdi(font_path.read_bytes(), descriptions)
        captures.append(dict(family=case['family'], face=case['face'], metafile=path.name,
                             metafileSha256=sha(path), font=font_path.name, fontSha256=sha(font_path),
                             horizontalUnitPt=scale, rows=observed, reselectedFontTables=selected))
        print(case['face'], len(observed), 'zero-gap script origins; verified', len(selected), 'font selections')
    reference = dict(referenceBuild='16.0.20326', capture='Range.EnhMetaFileBits',
                     sourceSha256=sha(FOLDER/'control.docx'), casesSha256=sha(FOLDER/'cases.json'), cases=captures)
    (FOLDER/'origin-reference.json').write_text(json.dumps(reference, indent=2)+'\n')


if __name__ == '__main__':
    main()
