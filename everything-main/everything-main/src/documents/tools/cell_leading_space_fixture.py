"""Original top/center/bottom cell leading-space controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape, quoteattr

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'

CASES=[(0,0,0,0),(2,0,0,0),(6,0,0,0),(2,36,0,0),(6,36,0,0),(0,36,0,0),(2,0,5,15),(2,36,5,15),(2,0,60,120),(2,36,60,120),(0,0,5,15),(6,0,5,15)]
CASES += [(2,0,5,15)]*4
body=''
for i,(before,height,top,bottom) in enumerate(CASES):
 body+='<w:p><w:pPr>'+('<w:pageBreakBefore/>' if i else '')+'<w:spacing w:after="0" w:line="360" w:lineRule="exact"/></w:pPr><w:r><w:t>Cell leading space '+str(i+1)+'</w:t></w:r></w:p>'
 body+='<w:tbl><w:tblPr><w:tblW w:w="8640" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="12"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>'+''.join('<w:'+side+' w:w="'+str(value)+'" w:type="dxa"/>' for side,value in [('top',top),('left',0),('bottom',bottom),('right',0)])+'</w:tblCellMar></w:tblPr><w:tblGrid>'+('<w:gridCol w:w="2880"/>'*3)+'</w:tblGrid><w:tr>'
 if i==14:body+='<w:trPr><w:tblHeader/></w:trPr>'
 if height:body+='<w:trPr><w:trHeight w:val="'+str(height*20)+'" w:hRule="exact"/></w:trPr>'
 for align in ['top','center','bottom']:
  body+='<w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/><w:vAlign w:val="'+align+'"/></w:tcPr><w:p><w:pPr>'+('<w:pStyle w:val="Shared"/>' if i>=13 else '')+('<w:contextualSpacing/>' if i>=12 else '')+'<w:spacing w:before="'+str(before*20)+'" w:after="0"/></w:pPr><w:r>'+('<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="22"/></w:rPr>' if i==15 else '')+'<w:t>'+align+'</w:t></w:r></w:p></w:tc>'
 body+='</w:tr></w:tbl>'
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
footer=''

parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+''.join('<Override PartName="/word/'+n+'.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.'+t+'+xml"/>' for n,t in [('document','document.main'),('styles','styles'),('settings','settings')])+'</Types>',
    '_rels/.rels': '<Relationships xmlns="'+REL+'"><Relationship Id="main" Type="'+R+'/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<Relationships xmlns="'+REL+'">'+''.join('<Relationship Id="'+n+'" Type="'+R+'/'+n+'" Target="'+n+'.xml"/>' for n in ['styles','settings'])+'</Relationships>',
    'word/document.xml': '<w:document xmlns:w="'+W+'" xmlns:r="'+R+'"><w:body>'+body+'</w:body></w:document>',
    'word/footer.xml': '<w:ftr xmlns:w="'+W+'">'+footer+'</w:ftr>',
    'word/styles.xml': '<w:styles xmlns:w="'+W+'"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
    'word/settings.xml': '<w:settings xmlns:w="'+W+'"><w:updateFields w:val="true"/></w:settings>',
}

parts.pop('word/footer.xml')
from xml.etree import ElementTree as ET
ET.register_namespace('w',W); ET.register_namespace('r',R)
xml=ET.fromstring(parts['word/document.xml'])
order=['pStyle','pageBreakBefore','spacing','contextualSpacing']
for pr in xml.iter('{'+W+'}pPr'):pr[:]=sorted(pr,key=lambda n:order.index(n.tag.split('}')[-1]))
parts['word/document.xml']=ET.tostring(xml,encoding='unicode')
parts['word/settings.xml']=parts['word/settings.xml'].replace('</w:settings>','<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>')
parts['word/styles.xml']=parts['word/styles.xml'].replace('</w:styles>','<w:style w:type="paragraph" w:styleId="Shared"><w:name w:val="Shared"/><w:pPr><w:contextualSpacing/></w:pPr></w:style></w:styles>')
with ZipFile(ROOT/'public/fixtures/cell-leading-space.docx','w',ZIP_DEFLATED) as z:
    for name,text in parts.items():z.writestr(name,text.encode())
