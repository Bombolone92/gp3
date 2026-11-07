"""Original persistent block-control behavior probes, authored as OPC/XML."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from xml.sax.saxutils import escape
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/persistent-block-controls';OUT.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def p(text):return '<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">'+escape(text)+'</w:t></w:r></w:p>'
cases=['insert','replace','delete-all','split','format','placeholder','temporary-false','two-paragraphs']
body=[]
for i,name in enumerate(cases):
 props=f'<w:alias w:val="{name}"/><w:tag w:val="original-{name}"/><w:id w:val="{500+i}"/>'
 if name=='placeholder':props+='<w:showingPlcHdr/>'
 if name=='temporary-false':props+='<w:temporary w:val="false"/>'
 props+='<w:richText/>'
 contents=p('Alpha beta')+(p('Second paragraph') if name=='two-paragraphs' else '')
 body.append(p('Before '+name)+f'<w:sdt><w:sdtPr>{props}</w:sdtPr><w:sdtEndPr/><w:sdtContent>{contents}</w:sdtContent></w:sdt>'+p('After '+name))
parts={
'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
'_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>'+''.join(body)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>'}
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+data)
