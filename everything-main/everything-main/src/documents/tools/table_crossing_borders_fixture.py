"""Original table cross-junction width/color controls, directly authored XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
body = ''
for label, horizontal, vertical, hcolor, vcolor in [
    ('Thin black horizontal, thick white vertical', 2, 48, '000000', 'FFFFFF'),
    ('Thin blue horizontal, thick red vertical', 2, 48, '0000FF', 'FF0000'),
    ('Thick blue horizontal, thin red vertical', 48, 2, '0000FF', 'FF0000'),
    ('Equal blue horizontal and red vertical', 24, 24, '0000FF', 'FF0000'),
    ('Equal red horizontal and blue vertical', 24, 24, 'FF0000', '0000FF'),
    ('Equal white horizontal and black vertical', 24, 24, 'FFFFFF', '000000'),
]:
    body += f'<w:p><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr><w:t>{label}</w:t></w:r></w:p>'
    body += f'<w:tbl><w:tblPr><w:tblW w:w="8640" w:type="dxa"/><w:tblBorders><w:insideH w:val="single" w:sz="{horizontal}" w:color="{hcolor}"/><w:insideV w:val="single" w:sz="{vertical}" w:color="{vcolor}"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4320"/><w:gridCol w:w="4320"/></w:tblGrid>'
    for row in range(3):
        body += '<w:tr><w:trPr><w:trHeight w:val="480" w:hRule="exact"/></w:trPr>'
        for column in range(2):
            body += '<w:tc><w:tcPr><w:tcW w:w="4320" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p></w:tc>'
        body += '</w:tr>'
    body += '</w:tbl>'
body += '<w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="1440" w:bottom="720" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
with ZipFile(ROOT / 'public/fixtures/numeric-page-fields.docx') as source:
    parts = {name: source.read(name) for name in ['[Content_Types].xml', '_rels/.rels', 'word/styles.xml', 'word/_rels/document.xml.rels']}
parts['word/footer.xml'] = f'<w:ftr xmlns:w="{W}"><w:p/></w:ftr>'.encode()
parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'.encode()
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
with ZipFile(ROOT / 'public/fixtures/table-crossing-borders.docx', 'w', ZIP_DEFLATED) as output:
    for name, data in parts.items():
        output.writestr(name, data)
