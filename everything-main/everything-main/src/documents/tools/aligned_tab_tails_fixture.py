from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
paras=[];cases=[]
for align in ['right','center']:
 for tail in ['none','one','three','next-tab','nbsp','break','mixed']:
  rp='<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/>'
  suffix={'none':'','one':' ','three':'   ','next-tab':'   ','nbsp':'\u00a0','break':'   ','mixed':''}[tail]
  run=f'<w:r><w:rPr>{rp}</w:rPr><w:tab/><w:t xml:space="preserve">AB12{suffix}</w:t>'
  if tail=='next-tab':run+='<w:tab/><w:t>Z</w:t>'
  if tail=='break':run+='<w:br/><w:t>Z</w:t>'
  run+='</w:r>'
  if tail=='mixed':run+='<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="48"/></w:rPr><w:t xml:space="preserve">  </w:t></w:r>'
  paras.append(f'<w:p><w:pPr><w:tabs><w:tab w:val="{align}" w:pos="3600"/><w:tab w:val="left" w:pos="7200"/></w:tabs><w:spacing w:before="0" w:after="160"/><w:rPr>{rp}</w:rPr></w:pPr>{run}</w:p>');cases.append({'alignment':align,'tail':tail})
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>','_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>','word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{"".join(paras)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'}
with ZipFile(Path(__file__).resolve().parents[1]/'tests/fixtures/aligned-tab-tails/source.docx','w',ZIP_DEFLATED) as z:
 for n,v in parts.items():z.writestr(n,v)
(Path(__file__).resolve().parents[1]/'tests/fixtures/aligned-tab-tails/cases.json').write_text(json.dumps(cases,indent=2))
