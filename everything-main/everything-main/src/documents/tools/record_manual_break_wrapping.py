"""Record bounded Unicode GDI page coordinates; never inspect font programs."""
import argparse
import gzip
import hashlib
import json
import struct
from pathlib import Path
from inspect_emf_text_records import inspect

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/manual-break-wrapping'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def page_reference(data):
    allowed = {1, 9, 10, 14, 18, 21, 22, 24, 30, 33, 34, 37, 40, 70, 76, 81, 82, 84, 98}
    offset, extent, dpi, pictures = 0, None, None, []
    while offset < len(data):
        kind, size = struct.unpack_from('<II', data, offset)
        assert kind in allowed and size >= 8 and size % 4 == 0 and offset + size <= len(data)
        record = data[offset:offset + size]
        if kind == 9:
            current = struct.unpack_from('<2i', record, 8)
            assert extent is None or current == extent
            extent = current
        elif kind == 10:
            assert struct.unpack_from('<2i', record, 8) == (0, 0)
        elif kind == 22:
            assert struct.unpack_from('<I', record, 8)[0] == 24
        elif kind == 70:
            assert record[12:16] == b'EMF+'
            pos = 16
            while pos < size:
                typ, flags, length, payload = struct.unpack_from('<HHII', record, pos)
                assert length >= 12 and length % 4 == 0 and pos + length <= size and payload == length - 12
                if typ == 0x4001:
                    assert flags == 1 and payload == 16
                    current = struct.unpack_from('<2I', record, pos + 20)
                    assert dpi is None or dpi == current
                    dpi = current
                pos += length
        elif kind == 81:
            assert size >= 80
            x, y = struct.unpack_from('<2i', record, 24)
            width, height = struct.unpack_from('<2i', record, 72)
            assert width > 0 and height > 0
            pictures.append(dict(xPt=x * .12, yPt=y * .12, widthPt=width * .12, heightPt=height * .12))
        offset += size
    # Physical Page API geometry and its 600-unit logical extents establish
    # this mapping. EMF+ picture transforms are separate from these GDI text
    # and bitmap records; viewport/world-transform GDI records are rejected.
    assert extent == (5100, 6600) and dpi == (600, 600)
    rows = []
    for row in inspect(data, include_italic=True):
        font = row['font']
        assert font['face'] == 'Arial' and font['weight'] == 400
        assert font['height'] == -100 or not row['text'].strip() and font['height'] == -200
        assert not font['italic'] and font['width'] == font['escapement'] == font['orientation'] == 0
        assert row['options'] == 4 and row['advanceDimensions'] == 1
        if row['text'].strip():
            assert font['height'] == -100
            rows.append(dict(text=row['text'].strip(), xPt=row['logicalOrigin'][0] * .12, baselinePt=row['logicalOrigin'][1] * .12))
    return dict(lines=rows, pictures=pictures)

def record(capture_root):
    result = dict(tolerancePt=.2, logicalUnitPt=.12, scopes={})
    for scope, subdir, pages in [('body', 'body-full', 13), ('header', 'header', 1), ('footer', 'footer', 1)]:
        directory = capture_root / subdir
        metadata = json.loads((directory / 'capture.json').read_text(encoding='utf-8-sig'))
        assert metadata['sourceUnchanged'] and metadata['savedBefore'] and metadata['savedAfter']
        source = (ROOT / f'{scope}.docx').read_bytes()
        assert sha(source) == metadata['sourceSha256'] and len(metadata['captures']) == pages
        bindings = []
        for index, binding in enumerate(metadata['captures'], 1):
            assert binding['page'] == index and binding['widthPt'] == 612 and binding['heightPt'] == 792
            data = (directory / binding['file']).read_bytes()
            assert sha(data) == binding['sha256'] and len(data) == binding['length']
            native = page_reference(data)
            assert len(native['pictures']) == (1 if scope == 'body' else 3)
            name = f'{scope}-page-{index}.emf.gz'
            (ROOT / name).write_bytes(gzip.compress(data, mtime=0))
            bindings.append(dict(page=index - 1, file=name, sha256=sha(data), **native))
        result['scopes'][scope] = dict(sourceSha256=sha(source), referenceBuild=metadata['referenceBuild'], savedBefore=True,
            savedAfter=True, sourceUnchanged=True, pages=bindings)
    (ROOT / 'native.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture_root', type=Path)
    args = parser.parse_args()
    result = record(args.capture_root)
    print(json.dumps({scope: dict(pages=len(r['pages']), lines=sum(len(p['lines']) for p in r['pages'])) for scope, r in result['scopes'].items()}))
