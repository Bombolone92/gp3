"""Original ruler fixture. Standard-library OOXML authoring, independent of the JS codec.

Run: python3 tools/canvas_ruler_fixture.py
No third-party engine, templates, fonts, or binary assets are used.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
ROOT = Path(__file__).resolve().parents[1]
PARTS = {
    '[Content_Types].xml': '''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>''',
    '_rels/.rels': '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>''',
    'word/document.xml': f'''<w:document xmlns:w="{W}"><w:body>
<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="1440" w:leader="dot"/><w:tab w:val="center" w:pos="2880"/><w:tab w:val="decimal" w:pos="5760"/></w:tabs><w:ind w:left="720" w:right="360" w:hanging="360"/></w:pPr><w:r><w:t>Ruler fixture</w:t><w:tab/><w:t>Left</w:t><w:tab/><w:t>Center</w:t><w:tab/><w:t>12.34</w:t></w:r></w:p>
<w:p><w:pPr><w:ind w:left="360" w:firstLine="180"/></w:pPr><w:r><w:t>A different paragraph keeps its own first-line indent.</w:t></w:r></w:p>
<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Second page ruler alignment.</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="360"/></w:sectPr>
</w:body></w:document>''',
    'customXml/ruler-provenance.xml': '<fixture source="tools/canvas_ruler_fixture.py" original="true">Preserve this untouched part.</fixture>',
}
if __name__ == '__main__':
    path = ROOT / 'public/fixtures/ruler.docx'
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        for name, xml in PARTS.items(): archive.writestr(name, xml)
    print(path)
