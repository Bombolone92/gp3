"""Original repeated-row controls; no corpus XML or artwork."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
root=Path(__file__).resolve().parents[1]
target=root/'tests/fixtures/compound-row-rounding';target.mkdir(exist_ok=True)
with ZipFile(root/'tests/fixtures/docpart-object/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def p(text,break_page=False):
 return '<w:p><w:pPr>'+('<w:pageBreakBefore/>' if break_page else '')+'<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr><w:t>'+text+'</w:t></w:r></w:p>'
body=''
cases=[(s,r,24) for s in ['nil','single','thinThickLargeGap'] for r in ['atLeast','exact']]
cases += [('thinThickLargeGap','atLeast',size) for size in [0,2,8,11,12,13,17,48,96]]
for i,(style,rule,size) in enumerate(cases):
 body+=p(f'{style} {rule} {size}',bool(i))
 body+='<w:tbl><w:tblPr><w:tblW w:w="4800" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4800"/></w:tblGrid>'
 for row in range(9):
  height=[504,1728,432][row%3]
  borders=''
  if row%3==1:borders='<w:tcBorders>'+''.join(f'<w:{side} w:val="{style}" w:sz="{size}" w:color="000000"/>' for side in ['top','bottom'])+'</w:tcBorders>'
  body+=f'<w:tr><w:trPr><w:trHeight w:val="{height}" w:hRule="{rule}"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="4800" w:type="dxa"/>{borders}<w:vAlign w:val="center"/></w:tcPr>'+p(f'Case {i+1} row {row+1}')+'</w:tc></w:tr>'
 body+='</w:tbl>'
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=(f'<w:document xmlns:w="{W}"><w:body>'+body+'</w:body></w:document>').encode()
with ZipFile(target/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
print(target/'control.docx')
(target/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
