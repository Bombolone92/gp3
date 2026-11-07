"""Bounded reference Range EMF audit; these captures are not page-layout references."""
import argparse
import hashlib
import json
import struct
from pathlib import Path

from audit_font_wrap_print_origins import audit
from inspect_emf_text_records import inspect


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mapping(data, *, width_pt=None, height_pt=None):
    offset, extent, header = 0, None, False
    allowed = {1, 9, 10, 14, 18, 22, 24, 37, 40, 70, 82, 84}
    while offset < len(data):
        kind, size = struct.unpack_from('<II', data, offset)
        assert kind in allowed and size >= 8 and size % 4 == 0 and offset + size <= len(data)
        record = data[offset:offset + size]
        if kind == 9:
            current = struct.unpack_from('<2i', record, 8)
            assert extent is None or extent == current
            extent = current
        elif kind == 10:
            assert struct.unpack_from('<2i', record, 8) == (0, 0)
        elif kind == 22:
            assert struct.unpack_from('<I', record, 8)[0] == 24
        elif kind == 70:
            assert record[12:16] == b'EMF+'
            position = 16
            while position < size:
                typ, flags, length, payload = struct.unpack_from('<HHII', record, position)
                assert length >= 12 and length % 4 == 0 and position + length <= size
                assert payload == length - 12
                body = record[position + 12:position + length]
                if typ == 0x4001:
                    assert not header and flags == 1 and len(body) == 16
                    assert struct.unpack_from('<2I', body, 8) == (600, 600)
                    header = True
                elif typ in (0x4002, 0x4004, 0x4022, 0x401e, 0x4024, 0x4021):
                    assert not body
                elif typ == 0x4030:
                    assert flags == 2 and struct.unpack('<f', body) == (1.0,)
                elif typ == 0x402a:
                    assert flags == 0 and struct.unpack('<6f', body) == (1, 0, 0, 1, 0, 0)
                else:
                    raise ValueError(f'Unmapped EMF+ record {typ:#x}')
                position += length
        offset += size
    frame = struct.unpack_from('<4i', data, 24)
    assert header and extent and frame[:2] == (0, 0)
    if width_pt is None:
        assert extent[0] == 3900
        scale = frame[2] / 2540 * 72 / extent[0]
    else:
        # Page API logical extents are normalized to the recorded document
        # page size. Driver frame metadata is not a screen-raster mapping.
        assert extent == (round(width_pt / .12), round(height_pt / .12))
        scale = width_pt / extent[0]
    assert abs(scale - .12) < 1e-12
    return scale


def device_audit(fixture, font):
    base = audit(fixture, font)
    root = fixture / 'device'
    capture = json.loads((root / 'capture.json').read_text(encoding='utf-8-sig'))
    assert capture['sourceSha256'] == base['sourceHashes']['control.docx']
    assert capture['sourceUnchanged'] and capture['savedBefore'] and capture['savedAfter']
    native = json.loads((fixture / 'reference.json').read_text())
    assert len(capture['captures']) == len(native['cases']) == 16
    paragraphs, design_errors, pdf_errors = [], [], []
    quantized_matches = 0
    for index, (binding, case) in enumerate(zip(capture['captures'], native['cases'], strict=True), 1):
        assert binding['paragraph'] == index and binding['file'] == f'paragraph-{index}.emf'
        path = root / binding['file']
        assert sha(path) == binding['sha256'] and path.stat().st_size == binding['length']
        data = path.read_bytes()
        scale = mapping(data)
        rows = [r for r in inspect(data, include_italic=True) if 'M' in r['text']]
        assert ''.join(r['text'] for r in rows).rstrip() == ' '.join(['MMMM'] * 8)
        positions = []
        for row in rows:
            f = row['font']
            assert f['face'] == 'Arial' and f['weight'] == 400 and not f['italic']
            assert f['width'] == f['escapement'] == f['orientation'] == 0
            assert f['height'] == -int(case['size'] / scale + .5)
            assert row['logicalOrigin'][0] == 0 and row['advanceDimensions'] == 1
            assert row['options'] == 4 and len(row['advances']) == len(row['text'])
            x, origin_list = 0, []
            for i, (char, advance) in enumerate(zip(row['text'], row['advances'], strict=True)):
                assert char in 'M ' and advance > 0
                spaces = i // 5
                design = ((i - spaces) * base['designAdvances']['M'] + spaces * base['designAdvances'][' ']) * case['size'] / base['unitsPerEm'] + i
                if char == 'M':
                    origin_list.append(x * scale)
                    design_errors.append(x * scale - design)
                    quantized_matches += x == int(design / scale + .5)
                x += advance
            positions.append(origin_list)
        original = case['lines'][0]['origins']
        n = min(len(original), len(positions[0]))
        differences = [positions[0][i] - (original[i] - original[0]) for i in range(n)]
        pdf_errors.extend(differences)
        paragraphs.append(dict(paragraph=index, size=case['size'], variant=case['variant'],
                               capturedFontHeight=rows[0]['font']['height'],
                               emfLineGlyphCounts=list(map(len, positions)),
                               pdfLineGlyphCounts=[len(r['origins']) for r in case['lines']],
                               comparedFirstLinePrefix=n,
                               maxAbsoluteEmfMinusPdfPt=max(map(abs, differences)),
                               emfRelativeOriginsPt=positions))
    assert len(design_errors) == 512 and len(pdf_errors) == 460
    return dict(sourceSha256=base['sourceHashes']['control.docx'],
                pdfSha256=base['sourceHashes']['native.pdf'], captureSha256=sha(root / 'capture.json'),
                fontSha256=base['inspectedFontSha256'], referenceBuild=capture['referenceBuild'],
                logicalUnitPt=.12, capturedOrigins=512, comparedPdfPrefixOrigins=460,
                maxAbsoluteDesignDifferencePt=max(map(abs, design_errors)),
                designNearestLogicalUnitMatches=quantized_matches,
                maxAbsoluteEmfMinusPdfPt=max(map(abs, pdf_errors)), paragraphs=paragraphs,
                scope='Relative origins in independent Range EMFs at 600 units/inch. Range capture reflows at fixed width, not native paragraph widths; prefixes only are compared to PDF. Neither screen glyph outlines nor generic rounding rules are established.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--font', type=Path, default=Path('C:/Windows/Fonts/arial.ttf'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    fixture = Path(__file__).resolve().parents[1] / 'tests/fixtures/font-size-wrap-boundary'
    result = device_audit(fixture, args.font)
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'paragraphs'}, indent=2))
