"""Independent XML fixture whose declared prompt wraps after restoration."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/empty-control-home-end'
OUT.mkdir(exist_ok=True)
with ZipFile(ROOT / 'tests/fixtures/empty-control-navigation/glossary.docx') as package:
    parts = {name: package.read(name) for name in package.namelist()}
prompt = ' '.join(f'Prompt{i:02}' for i in range(1, 41))
parts['word/glossary/document.xml'] = parts['word/glossary/document.xml'].replace(b'First prompt', prompt.encode())
with ZipFile(OUT / 'wrapped.docx', 'w', ZIP_DEFLATED) as package:
    for name, data in parts.items():
        package.writestr(name, data)
with ZipFile(ROOT / 'tests/fixtures/empty-control-navigation/control.docx') as package:
    base = {name: package.read(name) for name in package.namelist()}
for name, removed in [('leading', b'<w:r><w:t>A</w:t></w:r>'), ('trailing', b'<w:r><w:t>D</w:t></w:r>')]:
    parts = dict(base)
    assert removed in parts['word/document.xml']
    parts['word/document.xml'] = parts['word/document.xml'].replace(removed, b'')
    with ZipFile(OUT / f'{name}.docx', 'w', ZIP_DEFLATED) as package:
        for part, data in parts.items():
            package.writestr(part, data)
