"""Original geometric fonts, independently packaged by FontTools (MIT).

Run with fonttools 4.66.1. No third-party glyphs or font binaries are copied.
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables._k_e_r_n import KernTable_format_0
from fontTools.ttLib.sfnt import WOFFFlavorData

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/woff-controls'
ROOT.mkdir(parents=True, exist_ok=True)

for variant in ('legacy', 'positioning', 'optional', 'cff'):
    builder = FontBuilder(1000, isTTF=variant != 'cff')
    names = ['.notdef', 'space', 'A', 'V', 'separator']
    builder.setupGlyphOrder(names)
    builder.setupCharacterMap({32: 'space', 65: 'A', 86: 'V', 0x2028: 'separator'})
    glyphs = {}
    for name in names:
        pen = T2CharStringPen(600, None) if variant == 'cff' else TTGlyphPen(None)
        if name not in ('.notdef', 'space'):
            pen.moveTo((50, 0)); pen.lineTo((550, 0)); pen.lineTo((300, 700)); pen.closePath()
        glyphs[name] = pen.getCharString() if variant == 'cff' else pen.glyph()
    if variant == 'cff':
        builder.setupCFF('OriginalWOFFControl-Regular', {'FullName': 'Original WOFF Control Regular',
                         'FamilyName': 'Original WOFF Control', 'Weight': 'Regular'}, glyphs, {})
    else:
        builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: (250 if name == 'space' else 600, 0) for name in names})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({'familyName': 'Original WOFF Control', 'styleName': 'Regular',
                           'fullName': 'Original WOFF Control Regular', 'psName': 'OriginalWOFFControl-Regular'})
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200,
                    usWeightClass=300)
    builder.setupPost(); builder.setupMaxp()
    if variant == 'legacy':
        table = newTable('kern'); table.version = 0
        sub = KernTable_format_0(); sub.version = 0; sub.coverage = 1; sub.kernTable = {('A', 'V'): -80}
        table.kernTables = [sub]; builder.font['kern'] = table
    elif variant == 'positioning':
        addOpenTypeFeaturesFromString(builder.font, 'feature kern { pos A V -80; } kern;')
    builder.font['head'].created = builder.font['head'].modified = 3800000000
    raw = ROOT / f'{variant}.ttf'
    builder.font.save(raw)
    font = TTFont(raw, recalcTimestamp=False, recalcBBoxes=False)
    font.flavor = 'woff'
    if variant == 'optional':
        font.flavorData = WOFFFlavorData()
        font.flavorData.metaData = b'<metadata version="1.0"><description><text>Original control</text></description></metadata>'
        font.flavorData.privData = b'Original private block'
    font.save(ROOT / f'{variant}.woff')
    # An independent decoder gives the expected SFNT bytes, including checksum.
    decoded = TTFont(ROOT / f'{variant}.woff', recalcTimestamp=False, recalcBBoxes=False)
    decoded.flavor = None
    decoded.save(ROOT / f'{variant}-decoded.ttf')
