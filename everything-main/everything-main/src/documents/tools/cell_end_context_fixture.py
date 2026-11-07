"""Original contextual-spacing controls for the end of a table cell."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import sys
ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/cell-end-context';FOLDER.mkdir(exist_ok=True)
from canvas_first_section_fixture import parts as base,W,R
parts=dict(base)
styles=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Other"><w:name w:val="Other"/></w:style></w:styles>'
parts['word/styles.xml']=styles
body=''
for i in range(12):
 floating=i<4;ctx=i%4<2 if i<8 else True;other=i%2==1 if i<8 else False
 body+=f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i else ""}<w:spacing w:before="0" w:after="12" w:line="280" w:lineRule="exact"/></w:pPr><w:r><w:t>Case {i+1}: floating={floating}, contextual={ctx}, different={other}</w:t></w:r></w:p>'
 fp='<w:tblpPr w:leftFromText="0" w:rightFromText="0" w:vertAnchor="text" w:horzAnchor="margin" w:tblpX="0" w:tblpY="0"/>' if floating else ''
 body+=f'<w:tbl><w:tblPr>{fp}<w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/><w:shd w:val="clear" w:fill="208080"/></w:tcPr>'
 for s in (['Cell last'] if i in [8,9] else ['Cell first','Cell last']):
  cellstyle='<w:pStyle w:val="Other"/>' if i==9 or i==10 and s=='Cell last' or i==11 and s=='Cell first' else ''
  body+=f'<w:p><w:pPr>{cellstyle}<w:spacing w:before="0" w:after="160" w:line="280" w:lineRule="exact"/>{"<w:contextualSpacing/>" if ctx else ""}</w:pPr><w:r><w:t>{s}</w:t></w:r></w:p>'
 body+='</w:tc></w:tr></w:tbl>'
 for s in ['After table','Body marker']:
  style='<w:pStyle w:val="Other"/>' if other else ''
  body+=f'<w:p><w:pPr>{style}<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr><w:r><w:t>{s}</w:t></w:r></w:p>'
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{body}</w:body></w:document>'
with ZipFile(FOLDER/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)

# Separate style identity from the document default and arbitrary style ID.
for kind in ['default','id','name']:
 with ZipFile(FOLDER/'control.docx') as z,ZipFile(FOLDER/(kind+'.docx'),'w',ZIP_DEFLATED) as out:
  for n in z.namelist():
   b=z.read(n)
   if n=='word/styles.xml':
    if kind=='default':b=b.replace(b'w:default="1" w:styleId="Normal"',b'w:styleId="Normal"').replace(b'w:styleId="Other"',b'w:default="1" w:styleId="Other"')
    if kind=='id':b=b.replace(b'w:styleId="Normal"',b'w:styleId="BaseParagraph"')
    if kind=='name':b=b.replace(b'w:name w:val="Normal"',b'w:name w:val="Ordinary Text"')
   out.writestr(n,b)
