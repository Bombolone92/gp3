"""Original controls for preceding body flow and floating table page starts."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

FOLDER = Path(__file__).resolve().parents[1] / 'tests/fixtures/multipage-floating'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}
for name, count, offset in [('no-before', 0, 480), ('five-before', 5, 480), ('five-before-96pt', 5, 1920)]:
    with ZipFile(FOLDER / 'page-480-15.docx') as source:
        parts = {name: source.read(name) for name in source.namelist()}
    document = E.fromstring(parts['word/document.xml'])
    body = document.find('w:body', NS)
    body.remove(body.find('w:p', NS))
    table = body.find('w:tbl', NS)
    for index in range(count):
        p = E.Element(f'{{{W}}}p')
        r = E.SubElement(p, f'{{{W}}}r')
        E.SubElement(r, f'{{{W}}}t').text = f'Before {index}'
        table.addprevious(p)
    table.find('w:tblPr/w:tblpPr', NS).set(f'{{{W}}}tblpY', str(offset))
    parts['word/document.xml'] = E.tostring(document)
    with ZipFile(FOLDER / f'start-{name}.docx', 'w', ZIP_DEFLATED) as destination:
        for part, content in parts.items():
            destination.writestr(part, content)
