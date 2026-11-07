"""Original controls for table alignment with different first/later row borders."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
CASES = [('auto',0,48,'left'), ('auto',48,0,'left'), ('auto',24,48,'left'),
         ('auto',48,24,'left'), ('fixed',0,48,'left'), ('fixed',48,0,'left'),
         ('fixed',0,48,'center'), ('fixed',0,48,'right')]
def paragraph(text):
    return f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr><w:t>{text}</w:t></w:r></w:p>'
body = ''
for index, (layout, first, later, align) in enumerate(CASES):
    body += paragraph(f'Case {index}: {layout}, {align}, first {first}/8 pt, later {later}/8 pt')
    width = '<w:tblW w:w="0" w:type="auto"/>' if layout=='auto' else '<w:tblW w:w="8000" w:type="dxa"/>'
    body += f'<w:tbl><w:tblPr>{width}<w:jc w:val="{align}"/><w:tblLayout w:type="{"autofit" if layout=="auto" else "fixed"}"/><w:tblCellMar><w:left w:w="200" w:type="dxa"/><w:right w:w="200" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>'
    for row, size in enumerate([first,later]):
        body += '<w:tr><w:trPr><w:trHeight w:val="440" w:hRule="exact"/></w:trPr>'
        for column in range(2):
            side = 'left' if column==0 else 'right'
            edge = f'<w:{side} w:val="single" w:sz="{size}" w:color="008000"/>' if size else f'<w:{side} w:val="nil"/>'
            body += f'<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/><w:tcBorders>{edge}</w:tcBorders></w:tcPr>'+paragraph(f'C{index}R{row}X{column}')+'</w:tc>'
        body += '</w:tr>'
    body += '</w:tbl>'+paragraph('')
body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="1440" w:bottom="720" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
with ZipFile(ROOT/'public/fixtures/numeric-page-fields.docx') as source:
    parts={name:source.read(name) for name in ['[Content_Types].xml','_rels/.rels','word/styles.xml','word/_rels/document.xml.rels']}
parts['word/footer.xml']=f'<w:ftr xmlns:w="{W}"><w:p/></w:ftr>'.encode()
parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'.encode()
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
with ZipFile(ROOT/'public/fixtures/first-row-table-inset.docx','w',ZIP_DEFLATED) as output:
    for name,data in parts.items():output.writestr(name,data)
