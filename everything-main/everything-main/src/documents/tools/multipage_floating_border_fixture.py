"""Original border-width controls for floating table origins and page-edge limits."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

FOLDER = Path(__file__).resolve().parents[1] / 'tests/fixtures/multipage-floating'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}
for mode in ('', '-15'):
    for size, padding in [(0, 0), (24, 0), (8, 144)]:
        with ZipFile(FOLDER / f'margin-1920{mode}.docx') as source:
            parts = {name: source.read(name) for name in source.namelist()}
        document = E.fromstring(parts['word/document.xml'])
        borders = document.find('.//w:tblBorders', NS)
        if not size:
            borders.getparent().remove(borders)
        else:
            for border in borders:
                border.set(f'{{{W}}}sz', str(size))
        if padding:
            properties = document.find('.//w:tblPr', NS)
            margins = E.SubElement(properties, f'{{{W}}}tblCellMar')
            for side in ('left', 'right'):
                E.SubElement(margins, f'{{{W}}}{side}', {f'{{{W}}}w': str(padding), f'{{{W}}}type': 'dxa'})
        parts['word/document.xml'] = E.tostring(document)
        with ZipFile(FOLDER / f'border-{size}{"-pad" if padding else ""}{mode}.docx', 'w', ZIP_DEFLATED) as destination:
            for name, content in parts.items():
                destination.writestr(name, content)
