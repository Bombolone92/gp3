from zipfile import ZipFile,ZIP_DEFLATED
from pathlib import Path
target=Path(__file__).resolve().parents[1]/'tests/fixtures/underscore-text'
target.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
ps=[]
for family in ['Trebuchet MS','Arial']:
 for size in [12,16,28]:
  for spacing in [0,1]:
   props=f'<w:rFonts w:ascii="{family}" w:hAnsi="{family}"/><w:sz w:val="{size*2}"/>'+(f'<w:spacing w:val="{spacing}"/>' if spacing else '')
   ps.append(f'<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t>{family} {size}pt spacing {spacing}</w:t></w:r></w:p>')
   ps.append(f'<w:p><w:r><w:rPr>{props}</w:rPr><w:t>Before ____________ After</w:t></w:r></w:p>')
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>','_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>','word/document.xml':f'<w:document xmlns:w="{W}"><w:body>'+''.join(ps)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>'}
with ZipFile(target/'control.docx','w',ZIP_DEFLATED)as z:
 for n,s in parts.items():z.writestr(n,s.encode())
