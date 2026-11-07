"""Original controls isolating body flow around a multi-page floating table."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'tests/fixtures/multipage-floating'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}

for mode in ('', '-15'):
    for variant in ('full-width', 'long-following', 'no-before'):
        with ZipFile(FOLDER / f'text-480{mode}.docx') as source:
            parts = {name: source.read(name) for name in source.namelist()}
        document = E.fromstring(parts['word/document.xml'])
        body = document.find('w:body', NS)
        if variant == 'full-width':
            position = body.find('w:tbl/w:tblPr/w:tblpPr', NS)
            position.set(f'{{{W}}}tblpX', '0')
            for node in body.findall('.//w:tblW', NS) + body.findall('.//w:tcW', NS) + body.findall('.//w:gridCol', NS):
                node.set(f'{{{W}}}w', '9360')
        elif variant == 'long-following':
            # Many short body paragraphs expose their page allocation without
            # depending on word-wrapping metrics or an oversized single word.
            section = body.find('w:sectPr', NS)
            for index in range(60):
                paragraph = E.Element(f'{{{W}}}p')
                run = E.SubElement(paragraph, f'{{{W}}}r')
                E.SubElement(run, f'{{{W}}}t').text = f'Body {index:02d}'
                section.addprevious(paragraph)
        else:
            body.remove(body.find('w:p', NS))
        parts['word/document.xml'] = E.tostring(document)
        with ZipFile(FOLDER / f'flow-{variant}{mode}.docx', 'w', ZIP_DEFLATED) as destination:
            for name, content in parts.items():
                destination.writestr(name, content)
