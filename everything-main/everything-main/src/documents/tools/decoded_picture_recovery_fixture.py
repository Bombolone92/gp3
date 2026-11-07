"""Original XML controls for local bitmap recovery; standard library only.

Reuses the independently authored image-recovery OPC skeleton. Healthy/broken
pairs differ only in the compressed pixel stream of image2.png.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from image_recovery_fixture import W, R, A, WP, PIC, png, picture, p

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/decoded-picture-recovery'
G = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'
S = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'


def transform(x, y, w, h, extra='', group=False):
    return f'<a:xfrm {extra}><a:off x="{x*12700}" y="{y*12700}"/><a:ext cx="{w*12700}" cy="{h*12700}"/>' + (f'<a:chOff x="0" y="0"/><a:chExt cx="{w*12700}" cy="{h*12700}"/>' if group else '') + '</a:xfrm>'


def pic(n, x=0, y=0, w=60, h=60, extra='', crop=False):
    xml = picture(n).split('<pic:pic>')[1].split('</pic:pic>')[0]
    start, end = xml.index('<a:xfrm>'), xml.index('</a:xfrm>') + len('</a:xfrm>')
    xml = xml[:start] + transform(x, y, w, h, extra) + xml[end:]
    if crop:
        xml = xml.replace('<a:stretch>', '<a:srcRect l="25000" t="-50000"/><a:stretch>')
    return '<pic:pic>' + xml + '</pic:pic>'


def shape(n, x, w, fill, content='', outline=False):
    line = '<a:ln w="50800"><a:solidFill><a:srgbClr val="2244CC"/></a:solidFill></a:ln>' if outline else '<a:ln><a:noFill/></a:ln>'
    return f'<wps:wsp><wps:cNvPr id="{n}" name="Shape {n}"/><wps:cNvSpPr/><wps:spPr>' + transform(x, 0, w, 60) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' + fill + line + '</wps:spPr>' + (f'<wps:txbx><w:txbxContent>{content}</w:txbxContent></wps:txbx>' if content else '') + '<wps:bodyPr lIns="0" rIns="0" tIns="0" bIns="0" wrap="square"><a:noAutofit/></wps:bodyPr></wps:wsp>'


def group(content, nested=False):
    name = 'grpSp' if nested else 'wgp'
    return f'<wpg:{name}>' + ('<wpg:cNvPr id="90" name="Nested"/>' if nested else '') + '<wpg:cNvGrpSpPr/><wpg:grpSpPr>' + transform(0, 0, 300, 60, group=True) + f'</wpg:grpSpPr>{content}</wpg:{name}>'


def anchor(n, y, content, uri=G, width=300):
    return f'<w:p><w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="{n}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>{y*12700}</wp:posOffset></wp:positionV><wp:extent cx="{width*12700}" cy="762000"/><wp:wrapNone/><wp:docPr id="{n}" name="Recovery {n}"/><a:graphic><a:graphicData uri="{uri}">{content}</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'


def generate():
    with ZipFile(ROOT / 'tests/fixtures/image-recovery/healthy.docx') as z:
        parts = {n: z.read(n) for n in z.namelist()}
    green = '<a:solidFill><a:srgbClr val="14A050"/></a:solidFill>'
    body = p('Decoded picture recovery', '<w:pPr><w:pStyle w:val="Heading"/></w:pPr>')
    body += anchor(10, 120, pic(2, w=60, h=60, extra='rot="900000" flipH="1"', crop=True), PIC, 60)
    body += anchor(11, 220, group(group(pic(2, crop=True) + pic(1, x=90) + shape(20, 180, 120, green, p('Healthy sibling')), True)))
    stretch = '<a:blipFill><a:blip r:embed="image2"/><a:srcRect l="25000"/><a:stretch><a:fillRect l="25000"/></a:stretch></a:blipFill>'
    tile = '<a:blipFill><a:blip r:embed="image2"/><a:tile/></a:blipFill>'
    body += anchor(12, 320, group(shape(21, 0, 60, stretch, p('Fill text'), outline=True) + shape(22, 90, 60, tile) + pic(1, x=180)))
    inline = picture(2).replace('<a:stretch>', '<a:srcRect l="25000"/><a:stretch>').replace('<a:xfrm>', '<a:xfrm flipH="1">')
    textbox = '<w:p><w:r><w:t xml:space="preserve">Before </w:t></w:r>' + inline + '<w:r><w:t xml:space="preserve"> After</w:t></w:r></w:p>'
    body += anchor(13, 420, group(shape(23, 0, 240, '<a:noFill/>', textbox) + pic(1, x=240)))
    body += '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Retained numbered item</w:t></w:r></w:p>'
    body += '<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="180" w:footer="180" w:gutter="0"/></w:sectPr>'
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:pic="{PIC}" xmlns:wpg="{G}" xmlns:wps="{S}"><w:body>{body}</w:body></w:document>'.encode()
    OUT.mkdir(parents=True, exist_ok=True)
    for broken in [False, True]:
        parts['word/media/image2.png'] = png(broken)
        with ZipFile(OUT / ('broken.docx' if broken else 'healthy.docx'), 'w', ZIP_DEFLATED) as z:
            for name, data in parts.items():
                z.writestr(name, data)


if __name__ == '__main__':
    generate()
