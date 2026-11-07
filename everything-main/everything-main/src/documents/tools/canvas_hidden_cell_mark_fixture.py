"""Original independent OPC/XML fixture for end-of-cell marker height.

Uses only Python standard-library XML/ZIP and an original solid-color PNG.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as E
from html import escape
import struct, zlib, sys
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
SOURCE = Path(__file__).resolve().parents[1] / 'public/fixtures/hidden-cell-mark.docx'

def run(text, size=6):
    return f'<w:r><w:rPr><w:sz w:val="{size*2}"/></w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'

def paragraph(text='', mark=36, size=6, extra='', contents=None):
    return f'<w:p><w:pPr>{extra}<w:rPr><w:sz w:val="{mark*2}"/></w:rPr></w:pPr>' + (run(text, size) if contents is None else contents) + '</w:p>'

def cell(contents, hidden=True, merge=None):
    prop = '<w:tcW w:w="2880" w:type="dxa"/>'
    if merge: prop += f'<w:vMerge w:val="{merge}"/>'
    prop += '<w:hideMark/>' if hidden else '<w:hideMark w:val="off"/>'
    return '<w:tc><w:tcPr>' + prop + '</w:tcPr>' + contents + '</w:tc>'

def row(left, right, height=None):
    return '<w:tr>' + (f'<w:trPr><w:trHeight w:val="{height[1]}" w:hRule="{height[0]}"/></w:trPr>' if height else '') + left + right + '</w:tr>'

def generate():
    picture = '<w:r><w:drawing><wp:inline><wp:extent cx="152400" cy="152400"/><wp:docPr id="1" name="Original square"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Original square"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="square"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="152400" cy="152400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
    rows = row(cell(paragraph('Marker included'), False), cell(paragraph(), False))
    rows += row(cell(paragraph('Marker excluded')), cell(paragraph()))
    rows += row(cell(paragraph()), cell(paragraph()), ('atLeast', 60))
    rows += row(cell(paragraph(mark=18) + paragraph('Earlier paragraph remains')), cell(paragraph('Other cell')))
    rows += row(cell(paragraph('Exact row', size=18)), cell(paragraph()), ('exact', 240))
    rows += row(cell(paragraph(contents=run('Manual break') + '<w:r><w:rPr><w:sz w:val="12"/></w:rPr><w:br/></w:r>')), cell(paragraph('Peer')))
    rows += row(cell(paragraph(contents=picture)), cell(paragraph('Inline picture stays')))
    rows += row(cell(paragraph('Numbered', extra='<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')), cell(paragraph('Peer')))
    rows += row(cell(paragraph('Merged owner'), merge='restart'), cell(paragraph('Upper')), ('atLeast', 120))
    rows += row(cell(paragraph(), False, 'continue'), cell(paragraph('Lower')), ('atLeast', 120))
    body = paragraph('End-of-cell marker height', mark=12, size=12)
    body += '<w:tbl><w:tblPr><w:tblW w:w="5760" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>' + ''.join(f'<w:{side} w:w="0" w:type="dxa"/>' for side in ['top','left','bottom','right']) + '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid>' + rows + '</w:tbl>'
    body += paragraph('After table', mark=12, size=12)
    parts = {
      '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>',
      '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/_rels/document.xml.rels': f'<Relationships xmlns="{REL}"><Relationship Id="square" Type="{R}/image" Target="media/square.png"/><Relationship Id="numbers" Type="{R}/numbering" Target="numbering.xml"/></Relationships>',
      'word/numbering.xml': f'<w:numbering xmlns:w="{W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="360"/></w:tabs><w:ind w:left="360" w:hanging="360"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
      'word/document.xml': f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'}
    chunk = lambda name, data: struct.pack('>I', len(data)) + name + data + struct.pack('>I', zlib.crc32(name + data))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB',4,4,8,2,0,0,0)) + chunk(b'IDAT', zlib.compress((b'\0'+bytes([21,67,91])*4)*4)) + chunk(b'IEND',b'')
    with ZipFile(SOURCE,'w',ZIP_DEFLATED) as z:
        for name, contents in parts.items(): z.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>'+contents)
        z.writestr('word/media/square.png', png)

def verify(path):
    ns={'w':W}
    with ZipFile(SOURCE) as a, ZipFile(path) as b:
        assert set(a.namelist())==set(b.namelist())
        for name in a.namelist():
            if name!='word/document.xml': assert a.read(name)==b.read(name), name
        before, after=[E.fromstring(z.read('word/document.xml')) for z in [a,b]]
    assert ''.join(after.itertext())==''.join(before.itertext()).replace('Marker excluded','Changed small text',1)
    for tag in ['tcPr','tblPr','tblGrid','trPr','drawing']:
        assert [E.tostring(n) for n in before.findall('.//w:'+tag,ns)]==[E.tostring(n) for n in after.findall('.//w:'+tag,ns)],tag
    print('PASS preserved hidden marks, row geometry, image, numbering and edited content:',path)

if __name__=='__main__':
    if len(sys.argv)==1: generate()
    else:
        for path in sys.argv[1:]: verify(path)
