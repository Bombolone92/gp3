"""Original MIT font and authored OOXML for unavailable script-metric notices."""
import argparse
import tempfile
import struct
import zlib
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from paragraph_gap_rounding_fixture import generate as shell, N, W

FAMILY = 'Original Script Notice'
DEST = Path(__file__).resolve().parents[1] / 'tests/fixtures/script-metric-notice'


def generate(destination=DEST):
    destination.mkdir(parents=True, exist_ok=True)
    cmap = {c: f'u{c:04X}' for c in range(32, 127)}
    glyphs = ['.notdef', *cmap.values()]
    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder(glyphs)
    builder.setupCharacterMap(cmap)
    outlines = {}
    for glyph in glyphs:
        pen = TTGlyphPen(None)
        if glyph != cmap[32]:
            pen.moveTo((40, 0)); pen.lineTo((480, 0)); pen.lineTo((480, 700)); pen.lineTo((40, 700)); pen.closePath()
        outlines[glyph] = pen.glyph()
    builder.setupGlyf(outlines)
    builder.setupHorizontalMetrics({g: (300, 0) if g == cmap[32] else (600, 40) for g in glyphs})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable(dict(familyName=FAMILY, styleName='Regular', fullName=FAMILY,
                               psName='OriginalScriptNotice', uniqueFontIdentifier='OriginalScriptNotice-1',
                               version='Version 1.000', copyright='Original glyphs and tables, 2026. MIT License. Source: script_metric_notice_fixture.py',
                               licenseDescription='MIT License', licenseInfoURL='https://opensource.org/license/mit'))
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200, fsType=0, fsSelection=64,
                     ySubscriptXSize=600, ySubscriptYSize=600, ySubscriptXOffset=0, ySubscriptYOffset=300,
                     ySuperscriptXSize=600, ySuperscriptYSize=600, ySuperscriptXOffset=0, ySuperscriptYOffset=400)
    builder.setupPost(); builder.setupMaxp()
    builder.font['head'].created = builder.font['head'].modified = 3800000000
    builder.font.recalcTimestamp = False
    builder.save(destination / 'control.ttf')
    with tempfile.TemporaryDirectory() as temporary:
        shell(Path(temporary))
        with ZipFile(Path(temporary) / 'control.docx') as z:
            parts = {name: z.read(name) for name in z.namelist()}
    document = E.Element(N + 'document', nsmap={'w': W})
    body = E.SubElement(document, N + 'body')
    for family, text, script in [(FAMILY, 'NORMAL', None), (FAMILY, 'RAISED', 'superscript'),
                                  (FAMILY, 'LOWERED', 'subscript'), ('Noto Sans', 'BUNDLED', 'superscript')]:
        p = E.SubElement(body, N + 'p')
        run = E.SubElement(p, N + 'r'); rp = E.SubElement(run, N + 'rPr')
        E.SubElement(rp, N + 'rFonts', {N + 'ascii': family, N + 'hAnsi': family})
        E.SubElement(rp, N + 'sz', {N + 'val': '24'})
        if script:
            E.SubElement(rp, N + 'vertAlign', {N + 'val': script})
        E.SubElement(run, N + 't').text = text
    body.append(E.fromstring(parts['word/document.xml']).find(N + 'body/' + N + 'sectPr'))
    # The inherited script format on an image is not scripted text and must not
    # keep a text-metric notice alive after the real scripts are removed.
    p = E.Element(N + 'p'); body.insert(len(body) - 1, p)
    run = E.SubElement(p, N + 'r'); rp = E.SubElement(run, N + 'rPr')
    E.SubElement(rp, N + 'rFonts', {N + 'ascii': FAMILY, N + 'hAnsi': FAMILY})
    E.SubElement(rp, N + 'vertAlign', {N + 'val': 'subscript'})
    run.append(E.fromstring(b'''<w:drawing xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><wp:inline><wp:extent cx="190500" cy="190500"/><wp:docPr id="1" name="Original pixel"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Original pixel"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdPixel"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="190500" cy="190500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'''))
    types = E.fromstring(parts['[Content_Types].xml'])
    E.SubElement(types, '{http://schemas.openxmlformats.org/package/2006/content-types}Default', Extension='png', ContentType='image/png')
    parts['[Content_Types].xml'] = E.tostring(types)
    rels = E.fromstring(parts['word/_rels/document.xml.rels'])
    E.SubElement(rels, '{http://schemas.openxmlformats.org/package/2006/relationships}Relationship', Id='rIdPixel', Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', Target='media/pixel.png')
    parts['word/_rels/document.xml.rels'] = E.tostring(rels)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    parts['word/media/pixel.png'] = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>2I5B', 1, 1, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00\x30\x60\xa0\xff')) + chunk(b'IEND', b'')
    parts['word/document.xml'] = E.tostring(document, xml_declaration=True, encoding='UTF-8', standalone=True)
    with ZipFile(destination / 'control.docx', 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items():
            info = ZipInfo(name, (2020, 1, 1, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
            z.writestr(info, data)
    # A separate header-only script verifies the same notice in page stories.
    for p in list(body)[:-1]:
        if p.find(N + 'r/' + N + 't') is not None and p.find(N + 'r/' + N + 't').text in ['RAISED', 'LOWERED']:
            body.remove(p)
    R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    body[-1].insert(0, E.Element(N + 'headerReference', {N + 'type': 'default', '{' + R + '}id': 'rIdHeader'}))
    header = E.Element(N + 'hdr', nsmap={'w': W})
    p = E.SubElement(header, N + 'p'); run = E.SubElement(p, N + 'r'); rp = E.SubElement(run, N + 'rPr')
    E.SubElement(rp, N + 'rFonts', {N + 'ascii': FAMILY, N + 'hAnsi': FAMILY})
    E.SubElement(rp, N + 'sz', {N + 'val': '24'}); E.SubElement(rp, N + 'vertAlign', {N + 'val': 'superscript'})
    E.SubElement(run, N + 't').text = 'HEADER RAISED'
    E.SubElement(types, '{http://schemas.openxmlformats.org/package/2006/content-types}Override', PartName='/word/header1.xml', ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml')
    E.SubElement(rels, '{http://schemas.openxmlformats.org/package/2006/relationships}Relationship', Id='rIdHeader', Type=R + '/header', Target='header1.xml')
    parts.update({'[Content_Types].xml': E.tostring(types), 'word/_rels/document.xml.rels': E.tostring(rels),
                  'word/header1.xml': E.tostring(header), 'word/document.xml': E.tostring(document)})
    with ZipFile(destination / 'header-only.docx', 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items():
            info = ZipInfo(name, (2020, 1, 1, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
            z.writestr(info, data)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, default=DEST)
    generate(parser.parse_args().destination)
