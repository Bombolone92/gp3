"""Original mixed paper-size and orientation controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape, quoteattr

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'

SIZES=[(12240,15840),(15840,12240),(8640,14400),(14400,8640)]
def run(text):return '<w:r><w:t xml:space="preserve">'+escape(text)+'</w:t></w:r>'
def para(content,pr=''):return '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="320" w:lineRule="exact"/>'+pr+'</w:pPr>'+content+'</w:p>'
def section(width,height):return '<w:sectPr><w:footerReference w:type="default" r:id="footer"/><w:type w:val="nextPage"/><w:pgSz w:w="'+str(width)+'" w:h="'+str(height)+'" w:orient="'+('landscape' if width>height else 'portrait')+'"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
body=''
for i,(width,height) in enumerate(SIZES):
 n=i+1
 body+=para(run(f'Section {n} opening'))+para(run(f'Section {n} right edge'),'<w:jc w:val="right"/>')
 body+=para(run('The quick brown fox crosses the meadow while the distant hills stay visible. '*4))
 body+='<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>'+''.join('<w:'+side+' w:val="single" w:sz="4" w:color="2E74B5"/>' for side in ['top','left','bottom','right','insideH','insideV'])+'</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid>'
 for row in range(2):
  body+='<w:tr>'
  for col in range(2):body+='<w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr>'+para(run(f'S{n}R{row+1}C{col+1}'))+'</w:tc>'
  body+='</w:tr>'
 body+='</w:tbl>'+para(run(f'Section {n} ending'),section(width,height) if i<3 else '')
body+=section(*SIZES[-1])
footer=para(run('Page ' )+'<w:fldSimple w:instr="PAGE">'+run('99')+'</w:fldSimple>','<w:jc w:val="right"/>')

parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+''.join('<Override PartName="/word/'+n+'.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.'+t+'+xml"/>' for n,t in [('document','document.main'),('footer','footer'),('styles','styles'),('settings','settings')])+'</Types>',
    '_rels/.rels': '<Relationships xmlns="'+REL+'"><Relationship Id="main" Type="'+R+'/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<Relationships xmlns="'+REL+'">'+''.join('<Relationship Id="'+n+'" Type="'+R+'/'+n+'" Target="'+n+'.xml"/>' for n in ['footer','styles','settings'])+'</Relationships>',
    'word/document.xml': '<w:document xmlns:w="'+W+'" xmlns:r="'+R+'"><w:body>'+body+'</w:body></w:document>',
    'word/footer.xml': '<w:ftr xmlns:w="'+W+'">'+footer+'</w:ftr>',
    'word/styles.xml': '<w:styles xmlns:w="'+W+'"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
    'word/settings.xml': '<w:settings xmlns:w="'+W+'"><w:updateFields w:val="true"/></w:settings>',
}

with ZipFile(ROOT/'public/fixtures/mixed-page-sizes.docx','w',ZIP_DEFLATED) as z:
 for name,text in parts.items():z.writestr(name,text.encode())
