"""Original, independent OPC/XML fixture for preferred widths and merged AutoFit cells.

Python standard library only. No external artwork or editor implementation.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as E
from html import escape
import sys
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
SOURCE = Path(__file__).resolve().parents[1] / 'public/fixtures/merged-autofit.docx'

def paragraph(text):
    return '<w:p><w:r><w:rPr><w:rFonts w:ascii="Noto Sans" w:hAnsi="Noto Sans"/><w:sz w:val="24"/></w:rPr><w:t>' + escape(text) + '</w:t></w:r></w:p>'

def table(grid, rows):
    props = '<w:tblPr><w:tblW w:type="dxa" w:w="' + str(sum(grid)) + '"/><w:tblBorders>'
    props += ''.join('<w:' + side + ' w:val="single" w:sz="4" w:color="336699"/>' for side in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'])
    props += '</w:tblBorders><w:tblLayout w:type="autofit"/><w:tblCellMar>'
    props += ''.join('<w:' + side + ' w:w="0" w:type="dxa"/>' for side in ['top', 'left', 'bottom', 'right'])
    props += '</w:tblCellMar></w:tblPr>'
    result = '<w:tbl>' + props + '<w:tblGrid>' + ''.join('<w:gridCol w:w="' + str(w) + '"/>' for w in grid) + '</w:tblGrid>'
    for row in rows:
        result += '<w:tr>'; column = 0
        for span, text in row:
            result += '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="' + str(sum(grid[column:column + span])) + '"/>'
            if span > 1: result += '<w:gridSpan w:val="' + str(span) + '"/>'
            result += '</w:tcPr>' + paragraph(text) + '</w:tc>'; column += span
        assert column == len(grid)
        result += '</w:tr>'
    return result + '</w:tbl>'

def generate():
    body = paragraph('Merged width preferences')
    body += table([1440, 1440, 1440], [[(1, 'Side'), (2, 'x' * 20)], [(2, 'y' * 20), (1, 'End')], [(1, 'A'), (1, 'B'), (1, 'C')]])
    body += paragraph('Unequal columns')
    body += table([900, 1500, 1200, 1800], [[(1, 'Left'), (3, 'x' * 30)], [(2, 'y' * 12), (2, 'z' * 17)], [(1, 'D'), (1, 'E'), (1, 'F'), (1, 'G')]])
    body += paragraph('After both tables')
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>' + body + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'}
    with ZipFile(SOURCE, 'w', ZIP_DEFLATED) as z:
        for name, contents in parts.items(): z.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + contents)

def verify(path):
    ns = {'w': W}
    with ZipFile(SOURCE) as a, ZipFile(path) as b:
        assert set(a.namelist()) == set(b.namelist())
        for name in a.namelist():
            if name != 'word/document.xml': assert a.read(name) == b.read(name), name
        before, after = [E.fromstring(z.read('word/document.xml')) for z in [a, b]]
    assert ''.join(after.itertext()) == ''.join(before.itertext()).replace('Side', 'Revised', 1)
    # Layout never rewrites grid, preferences, spans, borders or margins.
    for name in ['tblPr', 'tblGrid', 'tcPr']:
        assert [E.tostring(n) for n in before.findall('.//w:' + name, ns)] == [E.tostring(n) for n in after.findall('.//w:' + name, ns)], name
    print('PASS merged AutoFit preferences, structure, edited text and unrelated package parts:', path)

if __name__ == '__main__':
    if len(sys.argv) == 1: generate()
    else:
        for path in sys.argv[1:]: verify(path)
