"""Independent run-level RTL and complex-script formatting controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/rtl-runs'
root.mkdir(exist_ok=True)
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
from xml.sax.saxutils import escape
cases=[]; body=[]
texts=['ABC def', '012 345', '٠١٢ ٣٤٥', 'אבג דהו', 'مرحبا بالعالم', 'ABC (אבג) 123', '٠']
for text in texts:
 for mode in ['ltr','rtl','rtl-cs-format']:
  i=len(cases); page=i//7
  props='<w:rtl w:val="0"/>' if mode=='ltr' else '<w:rtl/>'
  if mode=='rtl-cs-format': props='<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Courier New"/><w:bCs/><w:iCs/><w:sz w:val="20"/><w:szCs w:val="32"/>'+props
  cases.append(dict(index=i,page=page,text=text,mode=mode))
  pagebreak='<w:pageBreakBefore/>' if i%7==0 and i else ''
  body.append(f'<w:p><w:pPr>{pagebreak}<w:spacing w:before="0" w:after="120"/></w:pPr><w:r><w:t>Case {i+1}: {mode}</w:t></w:r></w:p>')
  body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="360" w:line="480" w:lineRule="exact"/></w:pPr><w:r><w:t xml:space="preserve">Left [ </w:t></w:r><w:r><w:rPr>{props}</w:rPr><w:t>{escape(text)}</w:t></w:r><w:r><w:t xml:space="preserve"> ] Right</w:t></w:r></w:p>')
body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>')
parts={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
 '_rels/.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="{r}/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="{r}/styles" Target="styles.xml"/><Relationship Id="settings" Type="{r}/settings" Target="settings.xml"/></Relationships>',
 'word/styles.xml':f'<w:styles xmlns:w="{w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
 'word/settings.xml':f'<w:settings xmlns:w="{w}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
 'word/document.xml':f'<w:document xmlns:w="{w}"><w:body>{"".join(body)}</w:body></w:document>',
}
with ZipFile(root/'control.docx','w',ZIP_DEFLATED) as z:
 for name,value in parts.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+value)
(root/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
print(root/'control.docx')
