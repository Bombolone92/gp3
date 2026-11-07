"""Create an independent flat table with bookmarks at every insertion boundary."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
work=Path(__file__).resolve().parents[1]/'public/fixtures'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
start=lambda id,name:f'<w:bookmarkStart w:id="{id}" w:name="{name}"/>'
end=lambda id:f'<w:bookmarkEnd w:id="{id}"/>'
point=lambda id,name:start(id,name)+end(id)
cell=lambda text:f'<w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc>'
row1='<w:tr>'+start(4,'CellOne')+cell('A1')+end(4)+point(6,'BetweenCells')+start(5,'CellTwo')+cell('B1')+end(5)+'</w:tr>'
row2='<w:tr>'+cell('A2')+cell('B2')+'</w:tr>'
table='<w:tbl>'+start(0,'WholeTable')+'<w:tblPr><w:tblW w:w="5760" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid>'
table+=point(8,'BeforeRows')+start(1,'RowOne')+row1+end(1)+point(3,'BetweenRows')+start(2,'RowTwo')+row2+end(2)+point(7,'AfterRows')+end(0)+'</w:tbl>'
body=start(9,'WholeBodyTable')+table+end(9)+'<w:p><w:r><w:t>After</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
parts={
'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
'_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'}
with ZipFile(work/'bookmark-insertion.docx','w',ZIP_DEFLATED) as archive:
    for name,text in parts.items():
        entry=ZipInfo(name,(2026,9,17,0,0,0));entry.compress_type=ZIP_DEFLATED
        archive.writestr(entry,text.encode('utf-8'))
print(work/'bookmark-insertion.docx')
