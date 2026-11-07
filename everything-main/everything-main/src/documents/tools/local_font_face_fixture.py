"""Original OPC/XML font-family probe; references installed fonts, embeds none."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
CT='application/vnd.openxmlformats-officedocument.wordprocessingml.'
body=''
for name, text, size, bold in [('Franklin Gothic Demi','LOCAL FACE HEADING',32,False),('Franklin Gothic Demi','BOLD LOCAL FACE',32,True),('Franklin Gothic Book','Regular family comparison.',22,False),('Arial','Arial control paragraph.',22,False)]:
    body+=f'<w:p><w:r><w:rPr><w:rFonts w:ascii="{name}" w:hAnsi="{name}"/>' + ('<w:b/>' if bold else '') + f'<w:sz w:val="{size}"/></w:rPr><w:t>{text}</w:t></w:r></w:p>'
parts={
 '[Content_Types].xml':f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/></Types>',
 '_rels/.rels':f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
}
path=Path(__file__).resolve().parents[1]/'public/fixtures/local-font-face.docx'
with ZipFile(path,'w',ZIP_DEFLATED) as archive:
    for name,xml in parts.items():archive.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
print(path)
