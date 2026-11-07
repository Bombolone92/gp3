from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/automatic-table-borders';folder.mkdir(parents=True,exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(root/'public/fixtures/exhausted-cell-indents.docx') as z:parts={n:z.read(n) for n in z.namelist()}
cases=[];body=[]
for i,(scope,fill) in enumerate((s,f) for f in ['000000','102030','DDDDDD','mixed'] for s in ['table','cell']):
 name=scope+'-'+fill;cases.append(dict(name=name,scope=scope,fill=fill))
 page='<w:pageBreakBefore/>' if i==4 else ''
 body.append(f'<w:p><w:pPr>{page}<w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr><w:t>{name}</w:t></w:r></w:p>')
 def borders(sides):return ''.join(f'<w:{s} w:val="single" w:sz="32" w:color="auto"/>' for s in sides)
 tb='<w:tblBorders>'+borders(['top','left','bottom','right','insideH','insideV'])+'</w:tblBorders>' if scope=='table' else ''
 body.append('<w:tbl><w:tblPr><w:tblW w:w="5760" w:type="dxa"/>'+tb+'<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid>')
 for row in range(2):
  body.append('<w:tr><w:trPr><w:trHeight w:val="720" w:hRule="exact"/></w:trPr>')
  for col in range(2):
   color= ('000000' if (row+col)%2==0 else 'FFFFFF') if fill=='mixed' else fill
   cb='<w:tcBorders>'+borders(['top','left','bottom','right'])+'</w:tcBorders>' if scope=='cell' else ''
   body.append('<w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/>'+cb+f'<w:shd w:val="clear" w:fill="{color}"/></w:tcPr><w:p/></w:tc>')
  body.append('</w:tr>')
 body.append('</w:tbl><w:p/>')
parts['word/document.xml']=(f'<w:document xmlns:w="{W}"><w:body>'+''.join(body)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>').encode()
with ZipFile(folder/'controls.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')


parts['word/document.xml']=parts['word/document.xml'].replace(b'<w:body>',b'<w:background w:color="102030"/><w:body>')
with ZipFile(folder/'controls-dark.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
