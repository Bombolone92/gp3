"""Original DOCX probe for native kerning of pairs beginning with a space."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/package/2006/relationships'
def run(t): return '<w:r><w:t xml:space="preserve">'+t+'</w:t></w:r>'
def control(t,n): return '<w:sdt><w:sdtPr><w:id w:val="'+str(n)+'"/><w:temporary/></w:sdtPr><w:sdtContent>'+run(t)+'</w:sdtContent></w:sdt>'
text='The World’s Best Dad'
paragraphs=[]
for i,content in enumerate([run(text),run('The ')+run('World’s Best Dad'),control('The',1)+control(' ',2)+control('World’s Best Dad',3),run('AVATAR Toffee'),run('The World’s Best Dad')]):
    fmt='<w:rFonts w:ascii="Rockwell" w:hAnsi="Rockwell"/><w:b/><w:spacing w:val="-30"/><w:kern w:val="'+('0' if i==4 else '28')+'"/><w:sz w:val="36"/>'
    content=content.replace('<w:r>','<w:r><w:rPr>'+fmt+'</w:rPr>')
    paragraphs.append('<w:p><w:pPr><w:spacing w:before="0" w:after="240" w:line="480" w:lineRule="exact"/><w:jc w:val="center"/></w:pPr>'+content+'</w:p>')
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
'_rels/.rels':'<Relationships xmlns="'+R+'"><Relationship Id="rDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
'word/document.xml':'<w:document xmlns:w="'+W+'"><w:body>'+''.join(paragraphs)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'}
with ZipFile(Path(__file__).resolve().parents[1] / 'public/fixtures/kerning-space-pairs.docx','w',ZIP_DEFLATED) as z:
    for n,v in parts.items(): z.writestr(n,v)
