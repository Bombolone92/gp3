"""Original read-only SDT rendering probes, authored as OPC/XML with stdlib only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import struct, zlib

OUT = Path(__file__).resolve().parents[1] / 'public/fixtures'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 40, 20, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress((b'\0' + b'\x20\x80\xc0' * 40) * 20)) + chunk(b'IEND', b'')

def run(text, props=''):
    return f'<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>'
def p(content, props=''):
    return f'<w:p><w:pPr>{props}</w:pPr>{content}</w:p>'
def sdt(content, identity, wrapped, kind='<w:richText/>'):
    return f'<w:sdt><w:sdtPr><w:id w:val="{identity}"/><w:lock w:val="sdtContentLocked"/>{kind}</w:sdtPr><w:sdtContent>{content}</w:sdtContent></w:sdt>' if wrapped else content

drawing = f'''<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="Original blue rectangle"/><a:graphic><a:graphicData uri="{PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Original blue rectangle"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="blue"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'''
styles = f'''<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:color w:val="2050C0"/><w:sz w:val="40"/></w:rPr></w:style></w:styles>'''
for wrapped in [False, True]:
    title = sdt(p(run('Preserved control content'), '<w:pStyle w:val="Title"/>'), 1, wrapped)
    inline = p(run('Before ') + sdt(run('red italic', '<w:i/><w:color w:val="C02050"/><w:sz w:val="32"/>') + sdt(run(' nested bold', '<w:b/>'), 3, wrapped), 2, wrapped) + run(' after'))
    picture = p(sdt(drawing, 4, wrapped, '<w:picture/>'))
    cell = '<w:tc><w:tcPr><w:tcW w:w="4320" w:type="dxa"/><w:shd w:val="clear" w:fill="DDEEFF"/></w:tcPr>' + sdt(p(run('Table text', '<w:b/>')), 6, wrapped) + '</w:tc>'
    table = '<w:tbl><w:tblPr><w:tblW w:w="4320" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/><w:bottom w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4320"/></w:tblGrid><w:tr>' + cell + '</w:tr></w:tbl>'
    body = title + inline + picture + sdt(table, 5, wrapped) + p(run('Following paragraph.'))
    parts = {
        '[Content_Types].xml': f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/><Override PartName="/word/styles.xml" ContentType="{CT}styles+xml"/></Types>',
        '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels': f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/><Relationship Id="blue" Type="{R}/image" Target="media/blue.png"/></Relationships>',
        'word/styles.xml': styles,
        'word/document.xml': f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
        'word/media/blue.png': png,
    }
    path = OUT / ('control-preview-locked.docx' if wrapped else 'control-preview-unwrapped.docx')
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data if isinstance(data, bytes) else '<?xml version="1.0" encoding="UTF-8"?>' + data)
    print(path)
