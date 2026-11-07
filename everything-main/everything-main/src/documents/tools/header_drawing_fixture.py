"""Original OPC fixture: repeated story drawings, local relationships and dash presets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
WP14 = 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing'
WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'
WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'
NS = f'xmlns:w="{W}" xmlns:r="{R}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:wp14="{WP14}" xmlns:wpg="{WPG}" xmlns:wps="{WPS}" xmlns:pic="{PIC}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="wp14"'
DASHES = ['solid', 'dot', 'dash', 'lgDash', 'dashDot', 'lgDashDot', 'lgDashDotDot', 'sysDash', 'sysDot', 'sysDashDot', 'sysDashDotDot']


def png(rgb):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>2I5B', 8, 8, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress((b'\0' + bytes(rgb) * 8) * 8)) + chunk(b'IEND', b'')


def picture(identifier):
    size = 36 * 12700
    return f'<w:r><w:drawing><wp:inline><wp:extent cx="{size}" cy="{size}"/><wp:docPr id="{identifier}" name="Local image"/><a:graphic><a:graphicData uri="{PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Local image"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="paint"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{size}" cy="{size}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'


def line(identifier, x, y, width, height, dash):
    x, y, width, height = (round(n * 12700) for n in (x, y, width, height))
    return f'<wps:wsp><wps:cNvPr id="{identifier}" name="{dash}"/><wps:cNvCnPr/><wps:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{width}" cy="{height}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="25400"><a:solidFill><a:srgbClr val="884488"/></a:solidFill><a:prstDash val="{dash}"/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>'


def anchor(identifier, content, *, horizontal='page', vertical='page', x=0, y=0, width=612, height=792, relative=''):
    return f'<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="{identifier}" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="{horizontal}"><wp:posOffset>{round(x*12700)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="{vertical}"><wp:posOffset>{round(y*12700)}</wp:posOffset></wp:positionV><wp:extent cx="{round(width*12700)}" cy="{round(height*12700)}"/><wp:wrapNone/><wp:docPr id="{identifier}" name="Story drawing"/><a:graphic><a:graphicData uri="{WPG}">{content}</a:graphicData></a:graphic>{relative}</wp:anchor></w:drawing></w:r>'


def group(width, height, content):
    w, h = round(width * 12700), round(height * 12700)
    return f'<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{w}" cy="{h}"/><a:chOff x="0" y="0"/><a:chExt cx="{w}" cy="{h}"/></a:xfrm></wpg:grpSpPr>{content}</wpg:wgp>'


def paragraph(content, extra=''):
    return f'<w:p><w:pPr>{extra}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>{content}</w:p>'


def relationships(items):
    return f'<Relationships xmlns="{REL}">' + ''.join(f'<Relationship Id="{i}" Type="{R}/{kind}" Target="{target}"/>' for i, kind, target in items) + '</Relationships>'


parts = {}
lines = ''.join(line(100+i, 72, 90+i*20, 240, 0, dash) for i, dash in enumerate(DASHES))
lines += line(150, 306, 0, 0, 792, 'solid')
relative = '<wp14:sizeRelH relativeFrom="page"><wp14:pctWidth>100000</wp14:pctWidth></wp14:sizeRelH><wp14:sizeRelV relativeFrom="page"><wp14:pctHeight>100000</wp14:pctHeight></wp14:sizeRelV>'
header = anchor(10, group(612, 792, lines), relative=relative) + picture(11)
parts['word/stories/header.xml'] = f'<w:hdr {NS}>{paragraph(header)}</w:hdr>'
footer = picture(20) + anchor(21, group(36, 36, line(151, 0, 0, 36, 36, 'dash')), horizontal='column', vertical='paragraph', x=72, width=36, height=36)
parts['word/stories/footer.xml'] = f'<w:ftr {NS}>{paragraph(footer)}</w:ftr>'
body = ''.join(paragraph(f'<w:r><w:t>Body page {i}</w:t></w:r>' + (picture(30) if i == 1 else ''), '<w:pageBreakBefore/>' if i > 1 else '') for i in range(1, 4))
section = '<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="7200" w:right="1440" w:bottom="1440" w:left="1440" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
parts['word/document.xml'] = f'<w:document {NS}><w:body>{body}{section}</w:body></w:document>'
parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>'
parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
parts['_rels/.rels'] = relationships([('main', 'officeDocument', 'word/document.xml')])
parts['word/_rels/document.xml.rels'] = relationships([('header', 'header', 'stories/header.xml'), ('footer', 'footer', 'stories/footer.xml'), ('paint', 'image', 'media/red.png'), ('settings', 'settings', 'settings.xml'), ('styles', 'styles', 'styles.xml')])
for story, color in [('header', 'green'), ('footer', 'blue')]:
    parts[f'word/stories/_rels/{story}.xml.rels'] = relationships([('paint', 'image', f'../media/{color}.png')])
for color, rgb in [('red', (255, 0, 0)), ('green', (0, 180, 0)), ('blue', (0, 0, 255))]:
    parts[f'word/media/{color}.png'] = png(rgb)
overrides = [('word/document.xml', 'document.main'), ('word/settings.xml', 'settings'), ('word/styles.xml', 'styles'), ('word/stories/header.xml', 'header'), ('word/stories/footer.xml', 'footer')]
parts['[Content_Types].xml'] = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/>' + ''.join(f'<Override PartName="/{name}" ContentType="{CT}{kind}+xml"/>' for name, kind in overrides) + '</Types>'
path = ROOT / 'public/fixtures/header-drawings.docx'
with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
    for name, data in parts.items():
        archive.writestr(name, data)
print(path)

# Footer controls distinguish visible text descenders from the paragraph mark.
for mode, addition in [('text', '<w:r><w:t>g</w:t></w:r>'), ('blank', '</w:p><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>')]:
    extra = dict(parts)
    extra['word/stories/footer.xml'] = extra['word/stories/footer.xml'].replace('</w:p></w:ftr>', addition + '</w:p></w:ftr>')
    with ZipFile(ROOT / f'public/fixtures/header-drawings-footer-{mode}.docx', 'w', ZIP_DEFLATED) as archive:
        for name, data in extra.items():
            archive.writestr(name, data)

# A percentage size includes the saved effect extents. The native reference therefore reduces
# the inner frame, whereas an ordinary fixed-size anchor keeps its frame.
for mode in ['relative', 'fixed']:
    extra = dict(parts)
    xml = extra['word/stories/header.xml']
    xml = xml.replace('<wp:wrapNone/>', '<wp:effectExtent l="0" t="0" r="19050" b="19050"/><wp:wrapNone/>', 1)
    xml = xml.replace('<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>', '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>', 1)
    if mode == 'fixed':
        xml = xml.replace(relative, '')
    extra['word/stories/header.xml'] = xml
    with ZipFile(ROOT / f'public/fixtures/header-drawings-{mode}-effects.docx', 'w', ZIP_DEFLATED) as archive:
        for name, data in extra.items():
            archive.writestr(name, data)

# Same independently authored drawing in an editable body, for edit/export/undo.
body_section = section.replace('<w:headerReference w:type="default" r:id="header"/>', '').replace('<w:footerReference w:type="default" r:id="footer"/>', '')
body_content = paragraph(header) + paragraph('<w:r><w:t>Editable drawing host</w:t></w:r>')
parts['word/document.xml'] = f'<w:document {NS}><w:body>{body_content}{body_section}</w:body></w:document>'
path = ROOT / 'public/fixtures/header-drawings-body.docx'
with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
    for name, data in parts.items():
        archive.writestr(name, data)
print(path)
