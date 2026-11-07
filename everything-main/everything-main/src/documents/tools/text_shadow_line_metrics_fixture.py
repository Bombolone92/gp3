from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
paras=[]
for face,size,bold,italic in [('Corbel',16,False,False),('Rockwell',36,True,True),('Rockwell',66,True,False)]:
 for effect in ['plain','shadow','outline','both']:
  props=f'<w:rFonts w:ascii="{face}" w:hAnsi="{face}"/><w:sz w:val="{size*2}"/>'+('<w:b/>' if bold else '')+('<w:i/>' if italic else '')
  effects=''
  if effect in ['shadow','both']:effects+='<w14:shadow w14:blurRad="0" w14:dist="38100" w14:dir="2640000" w14:sx="100000" w14:sy="100000" w14:kx="0" w14:ky="0" w14:algn="ctr"><w14:srgbClr w14:val="888888"/></w14:shadow>'
  if effect in ['outline','both']:effects+='<w14:textOutline w14:w="12700" w14:cap="rnd" w14:cmpd="sng" w14:algn="ctr"><w14:solidFill><w14:srgbClr w14:val="000000"/></w14:solidFill><w14:prstDash w14:val="solid"/><w14:bevel/></w14:textOutline>'
  props+=effects
  br='<w:pageBreakBefore/>'  if paras else ''
  lines='<w:br/>'.join(f'<w:t>Sample line {i}</w:t>' for i in range(1,4))
  paras.append(f'<w:p><w:pPr>{br}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:rPr>{props}</w:rPr></w:pPr><w:r><w:rPr>{props}</w:rPr>{lines}</w:r></w:p>')
  paras.append('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr><w:t>After</w:t></w:r></w:p>')
parts={
'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
'_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
'word/document.xml':f'<w:document xmlns:w="{w}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"><w:body>{"".join(paras)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'}
with ZipFile(Path(__file__).resolve().parents[1] / 'tests/fixtures/text-shadow-line-metrics/control.docx','w',ZIP_DEFLATED) as z:
 for name,xml in parts.items():z.writestr(name,xml)
