"""Original OPC/XML fixture for persistent rich-text control editing in the reference application."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
target = root / 'public/fixtures/persistent-inline-controls.docx'
w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases = ['insert', 'replace', 'delete-part', 'delete-all', 'split', 'format',
         'start-boundary', 'end-boundary', 'placeholder', 'temporary-false']
paragraphs = []
for i, case in enumerate(cases):
    properties = f'<w:alias w:val="{case}"/><w:tag w:val="original-{case}"/><w:id w:val="{100+i}"/>'
    if case == 'placeholder':
        properties += '<w:showingPlcHdr/>'
    if case == 'temporary-false':
        properties += '<w:temporary w:val="false"/>'
    properties += '<w:richText/>'
    paragraphs.append(f'<w:p><w:r><w:t xml:space="preserve">{case}: before </w:t></w:r>'
        f'<w:sdt><w:sdtPr>{properties}</w:sdtPr><w:sdtContent><w:r>'
        '<w:t>Alpha beta</w:t></w:r></w:sdtContent></w:sdt>'
        '<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>')
parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': f'<w:document xmlns:w="{w}"><w:body>{"".join(paragraphs)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
}
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for name, value in parts.items():
        archive.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + value)
print(target)

# A separate control proves that a placeholder is resolved from its declared
# glossary relationship after editing, saving and reopening the document.
parts['word/document.xml'] = parts['word/document.xml'].replace(
    '<w:id w:val="100"/>',
    '<w:id w:val="100"/><w:placeholder><w:docPart w:val="OriginalPrompt"/></w:placeholder>', 1)
parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>',
    '<Override PartName="/word/glossary/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml"/></Types>')
parts['word/_rels/document.xml.rels'] = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rGlossary" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/glossaryDocument" Target="glossary/document.xml"/></Relationships>'
parts['word/glossary/document.xml'] = f'<w:glossaryDocument xmlns:w="{w}"><w:docParts><w:docPart><w:docPartPr><w:name w:val="OriginalPrompt"/></w:docPartPr><w:docPartBody><w:p><w:r><w:rPr><w:b/><w:color w:val="2050C0"/></w:rPr><w:t>Enter name</w:t></w:r></w:p></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>'
target = target.with_name('persistent-inline-glossary.docx')
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for name, value in parts.items():
        archive.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + value)
print(target)
