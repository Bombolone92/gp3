"""Independent OPC/XML fixture for single-paragraph glossary restoration at a block boundary."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/empty-inline-controls/glossary'
OUT.mkdir(parents=True,exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def p(text, props='', run=''):
    return f'<w:p><w:pPr>{props}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/>{run}</w:rPr><w:t>{text}</w:t></w:r></w:p>'

prompt = p('First prompt', '<w:spacing w:after="160"/>', '<w:b/>')
body = ''
for i, name in enumerate(['filled', 'showing']):
    contents = p('Existing value') if name == 'filled' else prompt
    showing = '<w:showingPlcHdr/>' if name == 'showing' else ''
    body += p('Before ' + name) + f'<w:sdt><w:sdtPr><w:alias w:val="{name}"/><w:id w:val="{800+i}"/><w:placeholder><w:docPart w:val="OneParagraphPrompt"/></w:placeholder>{showing}<w:richText/></w:sdtPr><w:sdtContent>{contents}</w:sdtContent></w:sdt>' + p('After ' + name)
parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/glossary/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="glossary" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/glossaryDocument" Target="glossary/document.xml"/></Relationships>',
    'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>',
    'word/glossary/document.xml': f'<w:glossaryDocument xmlns:w="{W}"><w:docParts><w:docPart><w:docPartPr><w:name w:val="OneParagraphPrompt"/></w:docPartPr><w:docPartBody>{prompt}</w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>',
}
with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for name, xml in parts.items():
        z.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + xml)
