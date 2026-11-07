"""Audit supplied font inputs against a native reference without shipping either.

Usage: python tools/audit-font-source-equivalence.py input-dir reference-dir output-dir
Requires fontTools. This verifies stored rendering data, not authored-master
provenance, licensing, browser behavior, or full native layout fidelity.
"""
import hashlib
import io
import json
import sys
from pathlib import Path

from fontTools import version
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def table_xml(font, tag):
    stream = io.BytesIO()
    font.saveXML(stream, tables=[tag])
    return stream.getvalue()


def glyph_data(font, name):
    glyphs = font.getGlyphSet()
    pen = DecomposingRecordingPen(glyphs)
    glyphs[name].draw(pen)
    program = getattr(font['glyf'][name], 'program', None)
    return {
        'outline': pen.value,
        'metrics': font['hmtx'][name],
        'instructions': bytes(program.getBytecode()) if program else b'',
    }


def audit(source, reference, output):
    original = TTFont(source, recalcTimestamp=False, recalcBBoxes=False)
    native = TTFont(reference, recalcTimestamp=False, recalcBBoxes=False)
    # Snapshot stored bytes before lazy table decoding/recompilation. Comparing
    # getTableData after saveXML would hide an offset-only packing difference.
    source_raw = {tag: original.reader[tag] for tag in original.reader.keys()}
    native_raw = {tag: native.reader[tag] for tag in native.reader.keys()}
    source_names, native_names = original.getGlyphOrder(), native.getGlyphOrder()
    common = sorted(set(source_names) & set(native_names))
    differences = []
    for name in common:
        a, b = glyph_data(original, name), glyph_data(native, name)
        changed = [key for key in a if a[key] != b[key]]
        if changed:
            differences.append({'glyph': name, 'fields': changed})
    source_tables, native_tables = set(original.reader.keys()), set(native.reader.keys())
    same_tables, different_tables = [], []
    for tag in sorted(source_tables & native_tables):
        (same_tables if source_raw[tag] == native_raw[tag]
         else different_tables).append(tag)

    # A full TTX round trip checks that an editable table representation retains
    # every stored table. Semantic XML equality allows harmless offset repacking.
    # It does not establish availability of the designer's original masters.
    xml_path = output / (source.stem + '.ttx')
    rebuilt_path = output / source.name
    original.saveXML(xml_path)
    rebuilt = TTFont(recalcTimestamp=False, recalcBBoxes=False)
    rebuilt.importXML(xml_path)
    rebuilt.save(rebuilt_path)
    reopened = TTFont(rebuilt_path, recalcTimestamp=False, recalcBBoxes=False)
    assert set(reopened.reader.keys()) == source_tables, 'Round trip lost tables'
    assert reopened.getGlyphOrder() == source_names, 'Round trip changed glyph order'
    assert reopened.getBestCmap() == original.getBestCmap(), 'Round trip changed cmap'
    round_trip = {}
    for tag in sorted(source_tables):
        if reopened.reader[tag] == source_raw[tag]:
            round_trip[tag] = 'byte-identical'
        elif tag == 'head':
            a, b = vars(original['head']).copy(), vars(reopened['head']).copy()
            a.pop('checkSumAdjustment', None)
            b.pop('checkSumAdjustment', None)
            assert a == b, 'Round trip changed head properties'
            round_trip[tag] = 'checksum-only'
        elif tag == 'post':
            a, b = vars(original['post']).copy(), vars(reopened['post']).copy()
            # Format 2 can redundantly store names already represented by the
            # standard Mac name indices. Compiler packing removes these, while
            # preserving the resolved glyph order, mappings and header fields.
            a.pop('extraNames', None)
            b.pop('extraNames', None)
            assert a == b, 'Round trip changed resolved PostScript names'
            round_trip[tag] = 'resolved-name-and-header-identical'
        else:
            assert table_xml(original, tag) == table_xml(reopened, tag), f'Round trip changed {tag}'
            round_trip[tag] = 'semantic-XML-identical'
    metadata = {}
    for tag in ['head', 'OS/2']:
        a, b = vars(original[tag]), vars(native[tag])
        fields = {}
        for key in sorted(set(a) | set(b)):
            x, y = a.get(key), b.get(key)
            if key == 'panose':
                x, y = vars(x), vars(y)
            if x != y:
                fields[key] = {'input': x, 'reference': y}
        metadata[tag] = fields
    result = {
        'file': source.name,
        'inputSha256': digest(source),
        'referenceSha256': digest(reference),
        'inputBytes': source.stat().st_size,
        'unicodeMapsEqual': original.getBestCmap() == native.getBestCmap(),
        'glyphOrdersEqual': source_names == native_names,
        'comparedGlyphs': len(common),
        'missingInputGlyphs': sorted(set(native_names) - set(source_names)),
        'extraInputGlyphs': sorted(set(source_names) - set(native_names)),
        'differentGlyphs': differences,
        'byteIdenticalTables': same_tables,
        'differentTables': different_tables,
        'missingInputTables': sorted(native_tables - source_tables),
        'extraInputTables': sorted(source_tables - native_tables),
        'metadataDifferences': metadata,
        'roundTrip': {
            'ttxSha256': digest(xml_path),
            'rebuiltSha256': digest(rebuilt_path),
            'tables': round_trip,
        },
    }
    original.close()
    native.close()
    reopened.close()
    rebuilt.close()
    return result


def main():
    source, reference, output = map(Path, sys.argv[1:])
    if output.exists():
        raise ValueError('Use a fresh output directory; existing outputs are preserved')
    inputs = sorted(source.glob('*.ttf'))
    references = {path.name.casefold(): path for path in reference.glob('*.ttf')}
    if not inputs or any(path.name.casefold() not in references for path in inputs):
        raise ValueError('Every input must have a same-named reference font')
    output.mkdir(parents=True)
    results = [audit(path, references[path.name.casefold()], output) for path in inputs]
    report = {'fontTools': version, 'files': results,
              'limits': 'Stored data equivalence and TTX reproduction; not authored-master provenance or native rendering equivalence.'}
    (output / 'audit.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps([{'file': row['file'], 'glyphs': row['comparedGlyphs'],
                       'differentGlyphs': len(row['differentGlyphs']),
                       'roundTripTables': len(row['roundTrip']['tables'])} for row in results]))


if __name__ == '__main__':
    main()
