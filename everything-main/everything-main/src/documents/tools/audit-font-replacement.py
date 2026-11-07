"""Report Unicode coverage lost by a proposed font-resource replacement.

Usage: python tools/audit-font-replacement.py current-dir candidate-dir output.json
Pairs files by case-insensitive stem, allowing TTF/OTF/WOFF packaging changes.
Exits 1 if any pair loses Unicode mappings; does not certify rendering equivalence.
Requires FontTools (MIT); never modifies or installs a font.
"""
import hashlib
import json
import sys
import unicodedata
from pathlib import Path
from fontTools.ttLib import TTFont


def coverage(font):
    """Union Unicode cmap mappings, excluding the missing-glyph slot.

    Keep platform-specific maps out; getBestCmap alone can miss a character
    exposed through another Unicode encoding. Variation sequences are a
    separate capability and must not be counted as ordinary base characters.
    """
    glyphs = set(font.getGlyphOrder()[1:])
    points, variations = set(), set()
    for table in font['cmap'].tables:
        if table.format == 14:
            for selector, records in table.uvsDict.items():
                for base, glyph in records:
                    if glyph is None or glyph in glyphs:
                        variations.add((base, selector))
        elif table.isUnicode() and (table.platformID, table.platEncID) != (3, 0):
            points.update(code for code, glyph in table.cmap.items() if glyph in glyphs)
    return points, variations


def point(code):
    return {'codePoint': f'U+{code:04X}', 'name': unicodedata.name(chr(code), 'UNASSIGNED'),
            'category': unicodedata.category(chr(code))}


def describe(path, font, points, variations):
    os2 = font.get('OS/2')
    return {'file': path.name, 'bytes': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'unicodeCharacters': len(points), 'variationSequences': len(variations),
            'panose': vars(os2.panose) if os2 else None,
            'weight': os2.usWeightClass if os2 else None,
            'fontRevision': font['head'].fontRevision if 'head' in font else None}


def compare(current, candidate):
    current, candidate = Path(current), Path(candidate)
    with TTFont(current, recalcTimestamp=False, recalcBBoxes=False) as a, \
            TTFont(candidate, recalcTimestamp=False, recalcBBoxes=False) as b:
        old, old_variations = coverage(a)
        new, new_variations = coverage(b)
        lost, gained = old-new, new-old
        lost_variations = old_variations-new_variations
        return {'current': describe(current, a, old, old_variations),
                'candidate': describe(candidate, b, new, new_variations),
                'lostCharacters': [point(code) for code in sorted(lost)],
                'gainedCharacters': [point(code) for code in sorted(gained)],
                'lostVariationSequences': [{'base': point(base), 'selector': point(selector)}
                                           for base, selector in sorted(lost_variations)],
                'coveragePreserved': not lost and not lost_variations,
                'scope': 'Unicode repertoire only; no glyph-shape, shaping, kerning, native layout or performance certification'}


def files(root):
    result = {}
    for path in sorted(Path(root).iterdir()):
        if path.suffix.lower() not in ('.ttf', '.otf', '.woff'):
            continue
        key = path.stem.casefold()
        if key in result:
            raise ValueError(f'Ambiguous font stem {key}: {result[key].name}, {path.name}')
        result[key] = path
    return result


def main(args):
    if len(args) != 3:
        raise SystemExit('Usage: audit-font-replacement.py current-dir candidate-dir output.json')
    current, candidate = files(args[0]), files(args[1])
    unmatched = sorted(set(candidate)-set(current))
    if unmatched:
        raise ValueError(f'Candidate fonts lack an existing baseline: {unmatched}')
    if not candidate:
        raise ValueError('No candidate fonts found')
    pairs = [compare(current[key], candidate[key]) for key in sorted(candidate)]
    passed = all(pair['coveragePreserved'] for pair in pairs)
    Path(args[2]).write_text(json.dumps({'coveragePreserved': passed, 'pairs': pairs}, indent=2)+'\n', encoding='utf-8')
    print(f'{"PASS" if passed else "FAIL"}: {len(pairs)} font pairs; '+
          ', '.join(f'{pair["candidate"]["file"]}: {len(pair["lostCharacters"])} lost characters' for pair in pairs))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
