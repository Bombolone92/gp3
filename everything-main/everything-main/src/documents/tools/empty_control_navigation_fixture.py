"""Independently authored empty inline controls, with and without a glossary."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/empty-control-navigation'
OUT.mkdir(exist_ok=True)
with ZipFile(ROOT / 'tests/fixtures/inline-control-navigation/inline.docx') as package:
    base = {name: package.read(name) for name in package.namelist()}
xml = base['word/document.xml'].replace(b'<w:sdtContent><w:r><w:t>BC</w:t></w:r></w:sdtContent>', b'<w:sdtContent/>')
for name in ['control', 'glossary']:
    parts = dict(base)
    if name == 'glossary':
        with ZipFile(ROOT / 'tests/fixtures/empty-inline-controls/glossary/control.docx') as package:
            parts = {name: package.read(name) for name in package.namelist()}
        parts['word/document.xml'] = xml.replace(b'<w:richText/>', b'<w:placeholder><w:docPart w:val="OneParagraphPrompt"/></w:placeholder><w:richText/>')
    else:
        parts['word/document.xml'] = xml
    with ZipFile(OUT / f'{name}.docx', 'w', ZIP_DEFLATED) as package:
        for part, data in parts.items():
            package.writestr(part, data)
