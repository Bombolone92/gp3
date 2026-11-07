"""Original minimal OPC controls for section columns; no corpus content."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/column-flow'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def add(parent, tag_name, text=None, **attrs):
    node = E.SubElement(parent, '{%s}%s' % (W, tag_name))
    for k, v in attrs.items():
        node.set('{%s}%s' % (W, k), str(v))
    node.text = text
    return node


def paragraph(parent, text, column_break=False, page_break=False):
    p = add(parent, 'p'); pr = add(p, 'pPr')
    add(pr, 'widowControl', val=0)
    add(pr, 'spacing', before=0, after=0, line=360, lineRule='exact')
    r = add(p, 'r'); rp = add(r, 'rPr')
    add(rp, 'rFonts', ascii='Arial', hAnsi='Arial'); add(rp, 'sz', val=24)
    if column_break or page_break:
        add(r, 'br', type='page' if page_break else 'column')
    add(r, 't', text=text)
    return p


def generate(name):
    doc = E.Element('{%s}document' % W, nsmap={'w': W}); body = add(doc, 'body')
    if name in ['wide-table', 'table-flow']:
        cell_width = 1080 if name == 'table-flow' else 2880
        table = add(body, 'tbl'); props = add(table, 'tblPr')
        add(props, 'tblW', w=cell_width * 2, type='dxa')
        borders = add(props, 'tblBorders')
        for edge in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']:
            add(borders, edge, val='single', sz=8, color='2060A0')
        add(props, 'tblLayout', type='fixed')
        grid = add(table, 'tblGrid')
        for _ in range(2): add(grid, 'gridCol', w=cell_width)
        for i in range(10 if name == 'table-flow' else 1):
            row = add(table, 'tr')
            for label in ([f'L{i+1:02}', f'R{i+1:02}'] if name == 'table-flow' else ['Left cell', 'Right cell']):
                cell = add(row, 'tc'); cp = add(cell, 'tcPr'); add(cp, 'tcW', w=cell_width, type='dxa')
                paragraph(cell, label)
        paragraph(body, 'After table')
    elif name in ['explicit-break', 'page-break']:
        paragraph(body, 'Before break')
        paragraph(body, 'After break', column_break=name == 'explicit-break', page_break=name == 'page-break')
        paragraph(body, 'Following line')
    else:
        count = 5 if name == 'short' else 30
        for i in range(count): paragraph(body, 'Line %02d' % (i + 1))
    sect = add(body, 'sectPr'); add(sect, 'pgSz', w=7200, h=4320)
    add(sect, 'pgMar', top=720, right=720, bottom=720, left=720, header=0, footer=0, gutter=0)
    cols = add(sect, 'cols', num=2, space=720)
    if name == 'unequal':
        cols.set('{%s}equalWidth' % W, '0')
        add(cols, 'col', w=1440, space=720); add(cols, 'col', w=3600)
    if name == 'separator': cols.set('{%s}sep' % W, '1')
    settings = E.Element('{%s}settings' % W, nsmap={'w': W})
    compat = add(settings, 'compat')
    add(compat, 'compatSetting', name='compatibilityMode', uri='http://schemas.microsoft.com/office/word', val=15)
    parts = {
        '[Content_Types].xml': b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
        '_rels/.rels': b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels': b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
        'word/document.xml': E.tostring(doc, xml_declaration=True, encoding='UTF-8', standalone=True),
        'word/settings.xml': E.tostring(settings, xml_declaration=True, encoding='UTF-8', standalone=True),
    }
    with ZipFile(OUT / (name + '.docx'), 'w', ZIP_DEFLATED) as z:
        for path, data in parts.items(): z.writestr(path, data)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for name in ['short', 'equal-flow', 'unequal', 'separator', 'explicit-break', 'wide-table', 'page-break', 'table-flow']:
        generate(name)
