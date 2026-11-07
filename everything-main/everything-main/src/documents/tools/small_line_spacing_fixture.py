"""Original OOXML probes for sub-six-point minimum and exact line heights."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
def run(text):
 return f'<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr><w:t>{text}</w:t></w:r>'
def paragraph(text,spacing=''):
 return f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" {spacing}/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:pPr>{text}</w:p>'
rows=''
for value in [0,1,20,119,120,480]:
 cells=''
 for rule in ['atLeast','exact']:
  label=paragraph(run(f'{rule} {value/20:g} pt'))
  probe=paragraph(run('Ag')+run('').replace('<w:t></w:t>', '<w:br/>')+run('Bg'),f'w:line="{value}" w:lineRule="{rule}"')
  end=paragraph(run('End'))
  cells+=f'<w:tc><w:tcPr><w:tcW w:w="4800" w:type="dxa"/></w:tcPr>{label}{probe}{end}</w:tc>'
 rows+=f'<w:tr>{cells}</w:tr>'
table=f'<w:tbl><w:tblPr><w:tblW w:w="9600" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4800"/><w:gridCol w:w="4800"/></w:tblGrid>{rows}</w:tbl>'
parts={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
 '_rels/.rels':f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{paragraph(run("Small line spacing"))}{table}{paragraph(run("Following table"))}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>'}
out=root/'public/fixtures/small-line-spacing.docx'
with ZipFile(out,'w',ZIP_DEFLATED) as z:
 for name,xml in parts.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
print(out)
