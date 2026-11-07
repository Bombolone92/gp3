"""Compare exact-mask regular (optionally bold) ASCII paint with native GDI origins.

This is an origin diagnostic, not an EMF renderer, shaping engine or raster oracle.
"""
import argparse
import hashlib
import json
import re
import struct
from pathlib import Path
from inspect_emf_text_records import inspect


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compare(source, paint_path, native_root, *, include_bold=False, include_bmp=False):
    paint = json.loads(paint_path.read_text())
    metadata_path = native_root / 'page-capture.json'
    meta = json.loads(metadata_path.read_text(encoding='utf-8-sig'))
    assert sha(source) == meta['sourceSha256']
    assert paint['sourceSha256'] == meta['sourceSha256']
    assert meta['sourceUnchanged'] and meta['savedBefore'] and meta['savedAfter']
    assert len(meta['captures']) == paint['pages']
    glyphs = []
    for page, capture in enumerate(meta['captures']):
        assert capture['page'] == page + 1 and capture['file'] == f'page-{page+1}.emf'
        path = native_root / capture['file']
        data = path.read_bytes()
        assert len(data) == capture['length'] and sha(path) == capture['sha256']
        extent = (round(capture['widthPt'] / .12), round(capture['heightPt'] / .12))
        offset, saw_extent = 0, False
        world, stack = 1.0, []
        while offset < len(data):
            kind, length = struct.unpack_from('<II', data, offset)
            assert length >= 8 and length % 4 == 0 and offset + length <= len(data)
            # Nontext drawing records may temporarily scale their DC. Accept
            # only diagonal uniform scales, and require identity at every text
            # record. No viewport or map-mode changes are supported.
            assert kind not in (11, 12, 17)
            if kind == 33:
                stack.append(world)
            if kind == 34:
                level = struct.unpack_from('<i', data, offset+8)[0]
                assert level < 0 and -level <= len(stack)
                world, stack = stack[level], stack[:level]
            if kind in (35, 36):
                a, b, c, d, e, f = struct.unpack_from('<6f', data, offset+8)
                assert b == c == e == f == 0 and a == d and a > 0
                mode = 4 if kind == 35 else struct.unpack_from('<I', data, offset+32)[0]
                assert mode in (1, 2, 3, 4)
                world = 1.0 if mode == 1 else a if mode == 4 else world*a
            if kind == 84:
                assert abs(world-1) < 1e-12
            if kind == 9:
                assert struct.unpack_from('<2i', data, offset + 8) == extent
                saw_extent = True
            if kind == 10:
                assert struct.unpack_from('<2i', data, offset + 8) == (0, 0)
            if kind == 22:
                assert struct.unpack_from('<I', data, offset + 8)[0] == 24
            offset += length
        assert saw_extent
        for row in inspect(data, include_italic=True):
            font = row['font']
            assert font['escapement'] == font['orientation'] == 0
            assert row['options'] == 4 and row['advanceDimensions'] == 1
            assert len(row['advances']) == len(row['text'])
            x, y = row['logicalOrigin']
            for char, advance in zip(row['text'], row['advances'], strict=True):
                if not char.isspace():
                    glyphs.append(dict(page=page, text=char, x=x*.12, y=y*.12,
                                       face=font['face'], weight=font['weight'], italic=bool(font['italic'])))
                x += advance
    matches, excluded, used = [], [], set()
    for row in paint['rows']:
        # Only native regular and explicit bold are supported. A same-family
        # font of a different weight is not a valid origin reference.
        font_prefix = re.split(r'[\d.]+px\s+', row['font'], maxsplit=1)[0]
        assert re.fullmatch(r'(?:(?:normal|bold|400|700)\s+)*', font_prefix)
        weight = 700 if re.search(r'\bbold\b|\b700\b', font_prefix) else 400
        assert include_bold or weight == 400
        assert row['replayAdvanceErrorPx'] <= 1e-8
        assert row['differentPixels'] == row['alphaAbsoluteError'] == 0
        if include_bmp:
            # EMRTEXT counts UTF-16 units. Supplementary characters require a
            # separate advance policy; never pair their surrogate units here.
            assert row['text'] and all(ord(char) <= 0xffff
                and not 0xd800 <= ord(char) <= 0xdfff
                and (char.isprintable() or char == '\u00a0') for char in row['text'])
        else:
            assert re.fullmatch(r'[\x20-\x7e]+', row['text'])
        family_list = row['font'].split('px ', 1)[1].strip()
        quoted = re.match(r'''["']([^"']+)["']''', family_list)
        family = quoted.group(1) if quoted else family_list.split(',', 1)[0].strip()
        candidates = sorted([(i, g) for i, g in enumerate(glyphs)
                             if g['page']==row['page'] and g['weight']==weight and not g['italic']
                             and abs(g['y']-row['baselinePt']) < 1
                             and g['face'].casefold()==family.casefold()], key=lambda item:item[1]['x'])
        text = ''.join(c for c in row['text'] if not c.isspace())
        joined = ''.join(g['text'] for _, g in candidates)
        app = [x for x, char in zip(row['originsPt'], row['text'], strict=True) if not char.isspace()]
        starts = [i for i in range(len(joined)) if joined.startswith(text, i)
                  and abs(candidates[i][1]['x']-app[0]) < 1]
        if not starts:
            excluded.append(dict(page=row['page'], text=row['text'], reason='No bounded exact same-face same-weight native match'))
            continue
        start = min(starts, key=lambda i:abs(candidates[i][1]['x']-app[0]))
        native = candidates[start:start+len(text)]
        assert len(native) == len(app)
        assert not any(i in used for i, _ in native)
        used.update(i for i, _ in native)
        errors = [x-g['x'] for x, (_, g) in zip(app, native, strict=True)]
        relative = [error-errors[0] for error in errors]
        matches.append(dict(page=row['page'], text=row['text'], font=row['font'],
                            maxAbsoluteXPt=max(map(abs, errors)), maxRelativeXPt=max(map(abs, relative)),
                            baselineErrorPt=row['baselinePt']-native[0][1]['y'],
                            errorsPt=errors, relativeErrorsPt=relative))
    assert matches
    return dict(sourceSha256=meta['sourceSha256'], paintSha256=sha(paint_path),
                captureMetadataSha256=sha(metadata_path), referenceBuild=meta['referenceBuild'],
                matched=len(matches), glyphs=len(used), excluded=excluded,
                nativeUnmatchedGlyphs=len(glyphs)-len(used),
                maxAbsoluteXPt=max(r['maxAbsoluteXPt'] for r in matches),
                maxRelativeXPt=max(r['maxRelativeXPt'] for r in matches),
                maxBaselineErrorPt=max(abs(r['baselineErrorPt']) for r in matches), rows=matches,
                scope=f'Exact-mask {"regular/bold" if include_bold else "regular"} {"printable BMP" if include_bmp else "ASCII"} paint origins versus bounded same-face same-weight native GDI page text units; exclusions retained. Text-unit counts are not shaped glyph counts. No raster or general shaping equivalence claim.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('paint', type=Path)
    parser.add_argument('native', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--include-bold', action='store_true', help='Also match explicit bold paint to native weight 700; regular remains the default.')
    parser.add_argument('--include-bmp', action='store_true', help='Also match printable BMP characters and nonbreaking spaces after exact-mask validation; supplementary characters remain unsupported.')
    args = parser.parse_args()
    result = compare(args.source, args.paint, args.native, include_bold=args.include_bold, include_bmp=args.include_bmp)
    args.output.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({key:value for key, value in result.items() if key not in ('rows', 'excluded')}))
    print('Excluded paint runs:', len(result['excluded']))
