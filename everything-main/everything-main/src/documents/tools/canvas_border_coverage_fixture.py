"""Independent original DOCX for thin border coverage. Standard-library OPC/XML only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as E
from html import escape
import sys
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
SOURCE = Path(__file__).resolve().parents[1] / 'public/fixtures/border-coverage.docx'

def edge(side, style='single', size=4, color='15435B'):
    return f'<w:{side} w:val="{style}" w:sz="{size}" w:space="0" w:color="{color}"/>'

def paragraph(text, props=''):
    return '<w:p>' + ('<w:pPr>' + props + '</w:pPr>' if props else '') + '<w:r><w:rPr><w:rFonts w:ascii="Noto Sans" w:hAnsi="Noto Sans"/><w:sz w:val="24"/></w:rPr><w:t>' + escape(text) + '</w:t></w:r></w:p>'

def generate():
    body = paragraph('Thin borders')
    body += paragraph('Unequal paragraph corners', '<w:pBdr>' + ''.join(edge(side, size=size) for side, size in [('top', 2), ('left', 8), ('bottom', 4), ('right', 12)]) + '</w:pBdr><w:spacing w:after="180"/><w:ind w:left="113" w:right="157"/>')
    body += paragraph('Joined thin divider', '<w:pBdr>' + edge('bottom', size=2) + '</w:pBdr><w:spacing w:after="180"/>')
    body += '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="6000"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>'
    for style in ['single', 'double', 'triple', 'dotted', 'dashed', 'dashSmallGap', 'dotDash', 'dotDotDash']:
        body += '<w:tr>'
        for size in [2, 4]:
            body += '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="3000"/><w:tcBorders>' + ''.join(edge(side, style, size) for side in ['top', 'left', 'bottom', 'right']) + '</w:tcBorders></w:tcPr>' + paragraph(style + ' ' + str(size / 8) + ' pt') + '</w:tc>'
        body += '</w:tr>'
    body += '<w:tr><w:trPr><w:trHeight w:val="300" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="6000"/><w:gridSpan w:val="2"/></w:tcPr>' + paragraph('Exact row clips paragraph ink', '<w:pBdr>' + ''.join(edge(side, size=8) for side in ['top', 'left', 'bottom', 'right']) + '</w:pBdr>') + '</w:tc></w:tr></w:tbl>'
    body += paragraph('After the borders')
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>' + body + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1443" w:right="1440" w:bottom="1440" w:left="1441" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'}
    with ZipFile(SOURCE, 'w', ZIP_DEFLATED) as z:
        for name, contents in parts.items(): z.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + contents)

def verify(path):
    ns = {'w': W}
    with ZipFile(SOURCE) as a, ZipFile(path) as b:
        assert set(a.namelist()) == set(b.namelist())
        for name in a.namelist():
            if name != 'word/document.xml': assert a.read(name) == b.read(name), name
        before, after = [E.fromstring(z.read('word/document.xml')) for z in [a, b]]
    assert ''.join(after.itertext()) == ''.join(before.itertext()).replace('Thin borders', 'Edited thin borders', 1)
    for name in ['pBdr', 'tcPr', 'tblPr', 'tblGrid', 'trPr']:
        assert [E.tostring(n) for n in before.findall('.//w:' + name, ns)] == [E.tostring(n) for n in after.findall('.//w:' + name, ns)], name
    print('PASS unchanged border widths, patterns, colors, geometry, edited text and unrelated parts:', path)

if __name__ == '__main__':
    if len(sys.argv) == 1: generate()
    else:
        for path in sys.argv[1:]: verify(path)
