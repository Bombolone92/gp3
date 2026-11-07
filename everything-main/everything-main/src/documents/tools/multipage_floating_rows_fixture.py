"""Original repeated-header and split-row floating-table controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

FOLDER = Path(__file__).resolve().parents[1] / 'tests/fixtures/multipage-floating'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}
for mode in ('', '-15'):
    for kind in ('header', 'split', 'keep-before-single'):
        with ZipFile(FOLDER / f'text-480{mode}.docx') as source:
            parts = {name: source.read(name) for name in source.namelist()}
        document = E.fromstring(parts['word/document.xml'])
        table = document.find('.//w:tbl', NS)
        rows = table.findall('w:tr', NS)
        if kind == 'header':
            E.SubElement(rows[0].find('w:trPr', NS), f'{{{W}}}tblHeader')
        elif kind == 'split':
            properties = rows[0].find('w:trPr', NS)
            properties.remove(properties.find('w:cantSplit', NS))
            cell = rows[0].find('w:tc', NS)
            for index in range(70):
                p = E.SubElement(cell, f'{{{W}}}p')
                r = E.SubElement(p, f'{{{W}}}r')
                E.SubElement(r, f'{{{W}}}t').text = f'Long row line {index:02d}'
            for row in rows[1:-1]:
                table.remove(row)
        else:
            body = document.find('w:body', NS)
            before = body.find('w:p', NS)
            properties = E.Element(f'{{{W}}}pPr')
            E.SubElement(properties, f'{{{W}}}keepNext')
            before.insert(0, properties)
            for index in range(52):
                p = E.Element(f'{{{W}}}p')
                r = E.SubElement(p, f'{{{W}}}r')
                E.SubElement(r, f'{{{W}}}t').text = f'Fill {index:02d}'
                before.addprevious(p)
            for row in rows[1:]:
                table.remove(row)
            anchor = table.getnext()
            properties = E.Element(f'{{{W}}}pPr')
            E.SubElement(properties, f'{{{W}}}keepLines')
            anchor.insert(0, properties)
            r = E.SubElement(anchor, f'{{{W}}}r')
            E.SubElement(r, f'{{{W}}}br')
            E.SubElement(r, f'{{{W}}}t').text = 'Second line'
        parts['word/document.xml'] = E.tostring(document)
        with ZipFile(FOLDER / f'rows-{kind}{mode}.docx', 'w', ZIP_DEFLATED) as destination:
            for name, content in parts.items():
                destination.writestr(name, content)
