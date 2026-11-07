"""Original OOXML controls for exhausted paragraph writing widths in table cells."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from xml.sax.saxutils import escape
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
CT='application/vnd.openxmlformats-officedocument.wordprocessingml.'
cases=[('empty-left','',720,0,0),('letter-left','A',720,0,0),('words-left','AB CD',720,0,0),('empty-right','',0,720,0),('letter-right','B',0,720,0),('both','CD',360,360,0),('first-line','EF',0,0,720),('hanging','GH IJ',720,0,-720),('negative','KL',-720,0,0),('valid','MN',0,0,0),('center','OP',720,0,0),('right','QR',720,0,0),('tiny','iiii',720,0,0),('zero','iiii',295,0,0)]
def p(text,left=0,right=0,first=0):
 ind=f'<w:ind w:left="{left}" w:right="{right}" '+(f'w:hanging="{-first}"' if first<0 else f'w:firstLine="{first}"')+'/>'
 return f'<w:p><w:pPr><w:spacing w:before="0" w:after="0"/>{ind}</w:pPr><w:r><w:t>{escape(text)}</w:t></w:r></w:p>'
rows=''
for name,text,left,right,first in cases:
 content=p(text,left,right,first)
 if name in ['center','right']:content=content.replace('</w:pPr>',f'<w:jc w:val="{name}"/></w:pPr>')
 if name in ['tiny','zero']:content=content.replace('<w:r>','<w:r><w:rPr><w:sz w:val="2"/></w:rPr>')
 rows+='<w:tr>'+''.join(f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/></w:tcPr>{content}</w:tc>' for width,content in [(2400,p(name)),(300,content),(2400,p('after '+name))])+'</w:tr>'
borders=''.join(f'<w:{e} w:val="single" w:sz="4"/>' for e in ['top','left','bottom','right','insideH','insideV'])
margins=''.join(f'<w:{e} w:w="0" w:type="dxa"/>' for e in ['top','left','bottom','right'])
table=f'<w:tbl><w:tblPr><w:tblW w:w="5100" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="300"/><w:gridCol w:w="2400"/></w:tblGrid>{rows}</w:tbl>'
parts={'[Content_Types].xml':f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/><Override PartName="/word/styles.xml" ContentType="{CT}styles+xml"/></Types>', '_rels/.rels':f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>','word/_rels/document.xml.rels':f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/></Relationships>','word/styles.xml':f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>','word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{table}{p("End")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'}
path=Path(__file__).resolve().parents[1]/'public/fixtures/exhausted-cell-indents.docx'
with ZipFile(path,'w',ZIP_DEFLATED) as z:
 for n,x in parts.items():z.writestr(n,'<?xml version="1.0" encoding="UTF-8"?>'+x)
