"""Original page-boundary controls; no corpus content or third-party assets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

def p(text, height=280, after=0, extra=''):
    return f'<w:p><w:pPr>{extra}<w:spacing w:before="0" w:after="{after}" w:line="{height}" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr><w:t>{text}</w:t></w:r></w:p>'

body = ''
for i in range(9):
    body += p(f'Case {i}',3600,extra='<w:pageBreakBefore/>' if i else '')
    border = '' if i == 2 else '<w:tblBorders><w:top w:val="single" w:sz="12" w:color="008080"/></w:tblBorders>'
    body += f'<w:tbl><w:tblPr><w:tblW w:w="4800" w:type="dxa"/>{border}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="{120 if i == 1 else 0}" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid><w:tr>'
    if i in (6,7):
        body += f'<w:trPr><w:trHeight w:val="600" w:hRule="{"atLeast" if i == 6 else "exact"}"/></w:trPr>'
    for col in range(2):
        body += '<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>'
        text = f'C{i}X{col}'
        if i == 8:
            body += p(text)+p('Following paragraph',after=480)
        elif i == 3:
            body += p(text+'</w:t><w:br/><w:t>Second line',extra='<w:keepLines/>')
        elif i == 4:
            body += p(text,extra='<w:keepNext/>')+p('Kept following')
        else:
            body += p(text,after=0 if i == 5 and col == 1 else 480)
        body += '</w:tc>'
    body += '</w:tr></w:tbl>'+p(f'After {i}')
body += '<w:sectPr><w:pgSz w:w="7200" w:h="5440"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
    'word/settings.xml': f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
    'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>',
}
with ZipFile(ROOT/'public/fixtures/empty-table-fragment.docx','w',ZIP_DEFLATED) as z:
    for name, xml in parts.items():
        z.writestr(name,xml.encode())
