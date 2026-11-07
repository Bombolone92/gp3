"""Independent paragraph between-border distance controls; no template content."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/paragraph-between-distance';OUT.mkdir(parents=True,exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases=[];body=[]
for cell in [False,True]:
 for space in [0,1,4,9]:
  for spaced in [False,True]:
   i=len(cases);case=dict(id=i,cell=cell,space=space,before=18 if spaced else 0,after=10 if spaced else 0);cases.append(case)
   paragraphs=[]
   for j in range(3):
    borders=f'<w:bottom w:val="single" w:sz="8" w:space="9" w:color="0000FF"/><w:between w:val="single" w:sz="8" w:space="{space}" w:color="FF0000"/>'
    ppr=f'<w:pBdr>{borders}</w:pBdr><w:spacing w:before="{case["before"]*20 if j else 0}" w:after="{case["after"]*20}" w:line="240" w:lineRule="exact"/>'
    paragraphs.append(f'<w:p><w:pPr>{ppr}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr><w:t>C{i:02d}R{j}</w:t></w:r></w:p>')
   content=''.join(paragraphs)
   if cell:content='<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>'+''.join(f'<w:{s} w:w="0" w:type="dxa"/>' for s in ['top','left','bottom','right'])+'</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr>'+content+'</w:tc></w:tr></w:tbl><w:p/>'
   if i:body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
   body.append(content)
body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>', '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>', 'word/_rels/document.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>','word/settings.xml':f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>','word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'}
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,v in parts.items():z.writestr(n,v)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
