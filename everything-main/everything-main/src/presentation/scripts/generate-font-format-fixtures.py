"""Generate the original MIT-licensed glyphs in tests/data/font-formats.

Requires fonttools==4.65.0, also used by build-font-resources.py. This build tool
is not an application dependency. No external font data is used or modified.
"""

from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.t2CharStringPen import T2CharStringPen

destination = Path(__file__).resolve().parent.parent / "tests/data/font-formats"
destination.mkdir(parents=True, exist_ok=True)

for style, bold, italic in [
    ("Regular", False, False),
    ("Bold", True, False),
    ("Italic", False, True),
    ("BoldItalic", True, True),
    ("PreviewPrint", False, False),
    ("CFF", False, False),
    ("Wide", False, False),
    ("Plus", False, False),
]:
    cff = style == "CFF"
    family = ("+" if style == "Plus" else "") + "Font Format Regression" + (" CFF" if cff else "")
    subfamily = "Bold Italic" if bold and italic else (style if style in ("Bold", "Italic") else "Regular")
    font = FontBuilder(1000, isTTF=not cff)
    font.setupGlyphOrder([".notdef", "A", "V"])
    font.setupCharacterMap({65: "A", 86: "V"})
    glyphs = {}
    for name, points in {
        ".notdef": [(70, 0), (70, 700), (520, 700), (520, 0)],
        "A": [(40, 0), (270, 730), (510, 0), (410, 0), (270, 500), (140, 0)],
        "V": [(30, 730), (130, 730), (280, 190), (430, 730), (530, 730), (280, 0)],
    }.items():
        pen = T2CharStringPen(600, None) if cff else TTGlyphPen(None)
        transformed = [(x + (y // 6 if italic else 0), y) for x, y in points]
        pen.moveTo(transformed[0])
        for point in transformed[1:]:
            pen.lineTo(point)
        pen.closePath()
        glyphs[name] = pen.getCharString() if cff else pen.glyph()
    if cff:
        font.setupCFF("FontFormatRegression-CFF", {"FamilyName": family, "FullName": family, "Weight": "Regular"}, glyphs, {})
    else:
        font.setupGlyf(glyphs)
    advance = 900 if style == "Wide" else (640 if bold else 600)
    font.setupHorizontalMetrics({name: (advance, 30) for name in glyphs})
    font.setupHorizontalHeader(ascent=850, descent=-200)
    font.setupNameTable(
        {
            "familyName": family,
            "styleName": subfamily,
            "uniqueFontIdentifier": f"FontFormatRegression-{style}-1",
            "fullName": f"{family} {subfamily}",
            "psName": f"FontFormatRegression-{style}",
            "version": "Version 1.000",
            "copyright": "Copyright 2026 Presentation contributors. MIT License.",
            "licenseDescription": "MIT License; same terms as the repository LICENSE.",
            "licenseInfoURL": "https://opensource.org/license/mit",
        }
    )
    font.setupOS2(
        sTypoAscender=850,
        sTypoDescender=-200,
        usWinAscent=850,
        usWinDescent=200,
        usWeightClass=700 if bold else 400,
        fsType=4 if style == "PreviewPrint" else 0,
        fsSelection=(32 if bold else 0) | (1 if italic else 0) | (64 if not bold and not italic else 0),
    )
    font.setupPost(italicAngle=-10 if italic else 0)
    font.font["head"].macStyle = int(bold) | (int(italic) << 1)
    # OpenType's timestamp epoch. Fix metadata so rebuilding is reproducible.
    font.font["head"].created = font.font["head"].modified = 3850070400
    font.font.recalcTimestamp = False
    font.save(destination / f"{style}.ttf")
