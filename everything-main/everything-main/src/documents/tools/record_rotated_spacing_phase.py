"""Bind original paired inputs to the native reference's rotated text origins.

This records a bounded GDI coordinate experiment, not live-screen fidelity or
the bytes of the installed fonts. Reject unknown mapping and EMF+ records.
"""
import hashlib
import json
import struct
from zipfile import ZipFile
from inspect_emf_text_records import inspect
from record_rotated_phase_metafiles import baseline_records
from rotated_spacing_phase_fixture import build, FOLDER


def validate_wrapper(data):
    inspect(data)  # Establish record bounds first.
    offset, plus_header, active = 0, False, False
    allowed = {1, 9, 10, 13, 14, 18, 22, 24, 25, 30, 33, 34, 37, 39, 40, 70, 76, 82, 84}
    while offset < len(data):
        kind, size = struct.unpack_from('<II', data, offset)
        r = data[offset:offset + size]
        if kind not in allowed:
            raise ValueError(f'Unknown GDI record {kind}')
        if kind == 70:
            if r[12:16] != b'EMF+' or struct.unpack_from('<I', r, 8)[0] + 12 != size:
                raise ValueError('Unknown comment')
            p = 16
            while p < size:
                typ, flags, n, payload = struct.unpack_from('<HHII', r, p)
                if n < 12 or n % 4 or p + n > size or payload != n - 12:
                    raise ValueError('Invalid EMF+ record')
                body = r[p + 12:p + n]
                active = False
                if typ == 0x4001:
                    if plus_header or flags != 1 or len(body) != 16 or struct.unpack_from('<2I', body, 8) != (600, 600):
                        raise ValueError('Unexpected EMF+ header')
                    plus_header = True
                elif typ == 0x4004:
                    if not plus_header or flags or body:
                        raise ValueError('Unexpected GetDC')
                    active = True
                elif typ in (0x4022, 0x401e, 0x4024, 0x4021):
                    if body:
                        raise ValueError('Unexpected quality record')
                elif typ == 0x4030:
                    if flags != 2 or struct.unpack('<f', body) != (1.0,):
                        raise ValueError('Changed page transform')
                elif typ == 0x402a:
                    if flags or struct.unpack('<6f', body) != (1, 0, 0, 1, 0, 0):
                        raise ValueError('Changed world transform')
                elif typ == 0x4002:
                    if flags or body:
                        raise ValueError('Unexpected end record')
                else:
                    raise ValueError(f'Unknown EMF+ record {typ:#x}')
                p += n
        if kind == 84 and (not active or struct.unpack_from('<I', r, 24)[0] != 1):
            raise ValueError('Text outside established compatible-mode GDI interval')
        offset += size


def record(folder=FOLDER, source=build):
    parts, expected = source()
    with ZipFile(folder / 'control.docx') as z:
        if {n: z.read(n) for n in z.namelist()} != parts:
            raise ValueError('Source differs from original controlled construction')
    cases = json.loads((folder / 'cases.json').read_text())
    if cases != expected:
        raise ValueError('Cases differ from source construction')
    capture = json.loads((folder / 'capture.json').read_text(encoding='utf-8-sig'))
    if capture != dict(referenceBuild='16.0.20326', tables=36, readOnly=True):
        raise ValueError('Capture provenance changed; review new build explicitly')
    names, results = ['control.docx', 'cases.json', 'capture.json'], []
    for i, case in enumerate(cases, 1):
        name = f'native-table-{i}.emf'
        names.append(name)
        data = (folder / name).read_bytes()
        validate_wrapper(data)
        scale, rows = baseline_records(data, face=case['font'], advance={'Arial': 46, 'Times New Roman': 37, 'Courier New': 50}[case['font']])
        if scale != .12:
            raise ValueError('Changed logical mapping')
        labels = [r for r in inspect(data, include_italic=True) if r['text'] == 'a']
        # GM_COMPATIBLE device scales are distinct from logical frame mapping.
        if any(r['font']['italic'] or r['options'] != 4 or r['scale'] != [4.235294342041016, 4.2272725105285645] for r in labels):
            raise ValueError('Unexpected text attributes')
        results.append(dict(**case, logicalUnitPt=scale, rows=rows))
    return dict(referenceBuild=capture['referenceBuild'], hashes={n: hashlib.sha256((folder / n).read_bytes()).hexdigest() for n in names}, cases=results)


if __name__ == '__main__':
    result = record()
    (FOLDER / 'native-reference.json').write_text(json.dumps(result, indent=2) + '\n')
    print('Verified source construction and recorded 432 native baselines')
