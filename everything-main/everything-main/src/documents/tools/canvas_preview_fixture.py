"""Original best-effort fixture, authored independently with Python's standard library.
No external assets or document-engine code; source provenance for best-effort.docx.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>',
    '_rels/.rels': f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="header" Type="{R}/header" Target="header1.xml"/></Relationships>',
    'word/document.xml': f'''<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Best-effort opening</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Field result: </w:t></w:r><w:fldSimple w:instr="COMPARE 1 = 1"><w:r><w:t>September 17, 2026</w:t></w:r></w:fldSimple></w:p>
<w:p><w:del w:id="1" w:author="Fixture"><w:r><w:delText>Deleted words</w:delText></w:r></w:del><w:ins w:id="2" w:author="Fixture"><w:r><w:rPr><w:i/></w:rPr><w:t>Inserted words</w:t></w:r></w:ins></w:p>
<w:p><w:r><w:t>Still readable after unsupported content.</w:t></w:r></w:p>
<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:cols w:num="2" w:space="720"/></w:sectPr>
</w:body></w:document>''',
    'word/header1.xml': f'<w:hdr xmlns:w="{W}"><w:p><w:r><w:t>Preserved header</w:t></w:r></w:p></w:hdr>',
    'customXml/item1.xml': '<original>Keep this untouched</original>',
}
path = Path(__file__).resolve().parents[1] / 'public/fixtures/best-effort.docx'
with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
    for name, text in parts.items():
        archive.writestr(name, text)
print(path)
