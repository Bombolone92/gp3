"""Original OPC/XML control with a multiline glossary placeholder."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
with ZipFile(root / 'public/fixtures/persistent-inline-glossary.docx') as archive:
    parts = {name: archive.read(name) for name in archive.namelist()}
parts['word/glossary/document.xml'] = parts['word/glossary/document.xml'].replace(
    b'<w:t>Enter name</w:t>', b'<w:t>First line</w:t><w:br/><w:t>Second line</w:t><w:cr/><w:t>Third line</w:t>')
# Keep an existing value so deleting the whole control exercises restoration
# from its glossary, instead of merely reusing saved visible placeholder text.
target = root / 'public/fixtures/placeholder-breaks.docx'
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for name, value in parts.items():
        archive.writestr(name, value)
print(target)
