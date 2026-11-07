"""Original OOXML controls: healthy content surrounding one undecodable PNG.

Uses only Python's standard library; no desktop application or document engine is required.
The damaged file has valid XML and PNG dimensions but invalid compressed pixels.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import struct
import zlib

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/image-recovery'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'


def png(broken=False):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    pixels = b'not a zlib pixel stream' if broken else zlib.compress((b'\0' + bytes([20, 160, 80]) * 8) * 8)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 8, 8, 8, 2, 0, 0, 0)) + chunk(b'IDAT', pixels) + chunk(b'IEND', b'')


def picture(n):
    return f'''<w:r><w:drawing><wp:inline><wp:extent cx="457200" cy="457200"/><wp:docPr id="{n}" name="Picture {n}"/><a:graphic><a:graphicData uri="{PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="{n}" name="Picture {n}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image{n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'''


def p(text, props=''):
    return f'<w:p>{props}<w:r><w:t>{text}</w:t></w:r></w:p>'


def build(broken, background=False):
    body = p('Styled heading', '<w:pPr><w:pStyle w:val="Heading"/></w:pPr>')
    body += '<w:p>' + picture(1) + '</w:p>' + p('Between the pictures') + '<w:p>' + picture(2) + '</w:p>'
    body += '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' + p('Retained table cell') + '</w:tc></w:tr></w:tbl>'
    body += p('Numbered item', '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>')
    body += '<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:pgSz w:w="10080" w:h="14400"/><w:pgMar w:top="1440" w:right="1000" w:bottom="1440" w:left="1000" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
    parts = {
        'word/document.xml': f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:pic="{PIC}"><w:body>{body}</w:body></w:document>',
        'word/styles.xml': f'<w:styles xmlns:w="{W}"><w:style w:type="paragraph" w:styleId="Heading"><w:name w:val="Heading"/><w:rPr><w:b/><w:color w:val="204080"/><w:sz w:val="36"/></w:rPr></w:style></w:styles>',
        'word/header1.xml': f'<w:hdr xmlns:w="{W}">{p("Retained header")}</w:hdr>',
        'word/numbering.xml': f'<w:numbering xmlns:w="{W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
        'word/media/image1.png': png(), 'word/media/image2.png': png(broken),
    }
    if background:
        picture_background = '<w:background w:color="FFFFFF" xmlns:v="urn:schemas-microsoft-com:vml"><v:background id="PageBackground"><v:fill type="tile" r:id="image2"/></v:background></w:background>'
        parts['word/document.xml'] = parts['word/document.xml'].replace('<w:body>', picture_background + '<w:body>', 1)
    rels = [('styles', 'styles', 'styles.xml'), ('numbering', 'numbering', 'numbering.xml'), ('header', 'header', 'header1.xml'), ('image1', 'image', 'media/image1.png'), ('image2', 'image', 'media/image2.png')]
    parts['word/_rels/document.xml.rels'] = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(f'<Relationship Id="{i}" Type="{R}/{t}" Target="{target}"/>' for i, t, target in rels) + '</Relationships>'
    parts['_rels/.rels'] = f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>'
    kinds = [('document', 'document.main'), ('styles', 'styles'), ('numbering', 'numbering'), ('header1', 'header')]
    parts['[Content_Types].xml'] = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/>' + ''.join(f'<Override PartName="/word/{name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/>' for name, kind in kinds) + '</Types>'
    OUT.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUT / ('broken-background.docx' if background else 'broken.docx' if broken else 'healthy.docx'), 'w', ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)


if __name__ == '__main__':
    build(False)
    build(True)
    build(True, background=True)
