"""Original small-page section-boundary probes, authored directly as OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
root=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
sect='<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="4800" w:h="4800"/><w:pgMar w:top="400" w:right="400" w:bottom="400" w:left="400" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
fmt='<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/>'
def p(text='',props='',section=False,mark=fmt):
    return '<w:p><w:pPr>'+props+'<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/><w:rPr>'+mark+'</w:rPr>'+(sect if section else '')+'</w:pPr>'+(('<w:r><w:rPr>'+fmt+'</w:rPr><w:t xml:space="preserve">'+text+'</w:t></w:r>') if text else '')+'</w:p>'
cases=[('empty','', '',180),('text','Boundary','',180),('spaces','   ','',180),('border','','<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="0" w:color="FF0000"/></w:pBdr>',180),('shading','','<w:shd w:val="clear" w:fill="FFDDDD"/>',180),('page-break-before','','<w:pageBreakBefore/>',180),('roomy-empty','','',100)]
cases.extend(('roomy-'+name,text,props,100) for name,text,props,height in cases[3:6])
cases.append(('numbered-empty','','<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>',180))
body=[]
for i,(name,text,props,height) in enumerate(cases):
    body.append('<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="'+str(height*20)+'" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>'+p(name)+'</w:tc></w:tr></w:tbl>')
    body.extend([p(),p(text,props,True),p('After '+name,props if name=='numbered-empty' else '')])
    if i<len(cases)-1: body.append(p(section=True))
body.append(sect)
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>', 'word/document.xml':'<w:document xmlns:w="'+W+'"><w:body>'+''.join(body)+'</w:body></w:document>'}
parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>','<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>')
parts['word/_rels/document.xml.rels']='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>'
parts['word/numbering.xml']='<w:numbering xmlns:w="'+W+'"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:suff w:val="space"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
with ZipFile(root/'public/fixtures/empty-section-boundary.docx','w',ZIP_DEFLATED) as z:
    for n,v in parts.items(): z.writestr(n,v)
folder=root/'tests/fixtures/empty-section-boundary';folder.mkdir(exist_ok=True)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
