from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from xml.sax.saxutils import escape
out=Path(__file__).resolve().parents[1] / 'public/fixtures/native-line-metrics.docx'
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
paras=[]
for face in ['Arial','Times New Roman','Calibri','Courier New']:
 for size in [11,20,38]:
  props=f'<w:rFonts w:ascii="{face}" w:hAnsi="{face}"/><w:sz w:val="{size*2}"/>'
  br='<w:pageBreakBefore/>' if size==11 and paras else ''
  lines='<w:br/>'.join(f'<w:t>{escape(face)} {size} line {i}</w:t>' for i in range(1,4))
  paras.append(f'<w:p><w:pPr>{br}<w:spacing w:before="0" w:after="120" w:line="240" w:lineRule="auto"/><w:rPr>{props}</w:rPr></w:pPr><w:r><w:rPr>{props}</w:rPr>{lines}</w:r></w:p>')
parts={
'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
'_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
'word/document.xml':f'<w:document xmlns:w="{w}"><w:body>{"".join(paras)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'}
with ZipFile(out,'w',ZIP_DEFLATED) as z:
 for name,xml in parts.items():z.writestr(name,xml)
