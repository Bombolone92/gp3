"""Independently authored empty rich-text controls; no document-engine output."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/empty-inline-controls'
OUT.mkdir(exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
RP = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr>'

def run(text):
    return '<w:r>' + RP + '<w:t xml:space="preserve">' + escape(text) + '</w:t></w:r>'

def control(name, ident):
    return (f'<w:sdt><w:sdtPr>{RP}<w:alias w:val="{name}"/>'
            f'<w:tag w:val="empty-{name}"/><w:id w:val="{ident}"/><w:richText/>'
            '</w:sdtPr><w:sdtEndPr/><w:sdtContent/></w:sdt>')

contents = [
    control('start', 800) + run('Start suffix'),
    run('Middle prefix ') + control('middle', 801) + run(' suffix'),
    run('End prefix') + control('end', 802),
    control('alone', 803),
    run('Adjacent ') + control('left', 804) + control('right', 805) + run(' suffix'),
]
body = ''.join('<w:p><w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:pPr>' + c + '</w:p>' for c in contents)
parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>' + body + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>',
}
with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as package:
    for name, data in parts.items():
        package.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + data)
