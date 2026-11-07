"""Original inline/block glossary bookmark controls, authored as OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]/'tests/fixtures/glossary-bookmarks'
root.mkdir(exist_ok=True)
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
run=lambda t:f'<w:r><w:rPr><w:b/><w:color w:val="2050C0"/></w:rPr><w:t xml:space="preserve">{t}</w:t></w:r>'
start=lambda i,n:f'<w:bookmarkStart w:id="{i}" w:name="{n}"/>'
end=lambda i:f'<w:bookmarkEnd w:id="{i}"/>'
prompts={
 'whole':'<w:p>'+start(0,'PromptWhole')+run('Enter name')+end(0)+'</w:p>',
 'inner':'<w:p>'+run('En')+start(1,'PromptInner')+run('ter na')+end(1)+run('me')+'</w:p>',
 'point':'<w:p>'+run('Enter')+start(2,'PromptPoint')+end(2)+run(' name')+'</w:p>',
 'block':'<w:p>'+start(3,'PromptAcross')+run('First line')+'</w:p><w:p>'+start(4,'PromptSecond')+run('Second line')+end(4)+end(3)+'</w:p>',
}
body=['<w:p>'+start(0,'PromptWhole')+run('Outside bookmark')+end(0)+'</w:p>']
for i,name in enumerate(['whole','inner','point','shared','block']):
 prompt='whole' if name=='shared' else name
 content='<w:r><w:t>Existing value</w:t></w:r>'
 if name=='block':content='<w:p>'+content+'</w:p>'
 control=f'<w:sdt><w:sdtPr><w:alias w:val="{name}"/><w:id w:val="{100+i}"/><w:placeholder><w:docPart w:val="{prompt}"/></w:placeholder><w:richText/></w:sdtPr><w:sdtContent>{content}</w:sdtContent></w:sdt>'
 body.append(control if name=='block' else '<w:p><w:r><w:t xml:space="preserve">'+name+': </w:t></w:r>'+control+'</w:p>')
parts={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/glossary/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml"/></Types>',
 '_rels/.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="{r}/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="{r}/styles" Target="styles.xml"/><Relationship Id="glossary" Type="{r}/glossaryDocument" Target="glossary/document.xml"/></Relationships>',
 'word/styles.xml':f'<w:styles xmlns:w="{w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
 'word/document.xml':f'<w:document xmlns:w="{w}"><w:body>{"".join(body)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
 'word/glossary/document.xml':f'<w:glossaryDocument xmlns:w="{w}"><w:docParts>'+''.join(f'<w:docPart><w:docPartPr><w:name w:val="{n}"/><w:types><w:type w:val="bbPlcHdr"/></w:types></w:docPartPr><w:docPartBody>{v}</w:docPartBody></w:docPart>' for n,v in prompts.items())+'</w:docParts></w:glossaryDocument>',
}
with ZipFile(root/'control.docx','w',ZIP_DEFLATED) as z:
 for n,v in parts.items():z.writestr(n,'<?xml version="1.0" encoding="UTF-8"?>'+v)
print(root/'control.docx')
