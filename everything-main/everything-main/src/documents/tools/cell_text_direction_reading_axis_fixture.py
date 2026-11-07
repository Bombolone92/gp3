"""Original paired nested/ordinary rotated labels at two page origins."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
r=Path(__file__).resolve().parents[1]
w=r/'tests/fixtures/cell-text-direction/reading-axis';w.mkdir(exist_ok=True)
with ZipFile(r/'tests/fixtures/cell-text-direction/mode15.docx') as z:parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'.encode()
para=lambda text: '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>'+text+'</w:t></w:r></w:p>'
mar='<w:tcMar>'+''.join(f'<w:{s} w:w="{v}" w:type="dxa"/>' for s,v in [('top',5),('left',108),('bottom',5),('right',108)])+'</w:tcMar>'
borders='<w:tblBorders>'+''.join(f'<w:{s} w:val="single" w:sz="4" w:color="336699"/>' for s in ['top','left','bottom','right','insideH','insideV'])+'</w:tblBorders>'
body=''
for page,(nested,space) in enumerate([(False,1440),(True,1440),(False,5000),(True,5000)]):
 body+=f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if page else ""}<w:spacing w:line="{space}" w:lineRule="exact"/></w:pPr></w:p>'
 table='<w:tbl><w:tblPr><w:tblW w:w="1770" w:type="dxa"/>'+borders+'<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>'+('<w:gridCol w:w="590"/>'*3)+'</w:tblGrid>'
 for text,height in [('Very well',912),('Somewhat',1009),('Not well',870)]:
  table+=f'<w:tr><w:trPr><w:trHeight w:val="{height}" w:hRule="exact"/></w:trPr>'
  for direction in ['btLr','btLr','tbRl']:
   table+='<w:tc><w:tcPr><w:tcW w:w="590" w:type="dxa"/>'+mar+f'<w:textDirection w:val="{direction}"/><w:vAlign w:val="center"/></w:tcPr>'+para(text)+'</w:tc>'
  table+='</w:tr>'
 table+='</w:tbl>'
 if nested:
  table='<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>'+''.join(f'<w:{s} w:w="0" w:type="dxa"/>' for s in ['top','left','bottom','right'])+'</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>'+table+'<w:p/></w:tc></w:tr></w:tbl>'
 body+=table
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
with ZipFile(w/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
