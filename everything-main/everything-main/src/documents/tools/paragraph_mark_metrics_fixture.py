"""Original controls for oversized paragraph marks in body and table cells."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
with ZipFile(root/'public/fixtures/reviewed-font.docx') as z:parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def font(size):return f'<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="{size*2}"/>'
def p(text,mark=12):return f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:rPr>{font(mark)}</w:rPr></w:pPr><w:r><w:rPr>{font(12)}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
body=p('Body regular mark')+p('Body large mark',24)+p('Body following line')
for kind in ('ordinary','hidden'):
 body+='<w:tbl><w:tblPr><w:tblW w:w="10800" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="5400"/><w:gridCol w:w="5400"/></w:tblGrid><w:tr>'
 for mark in (12,24):
  body+=f'<w:tc><w:tcPr><w:tcW w:w="5400" w:type="dxa"/>'+('<w:hideMark/>' if kind=='hidden' else '')+'</w:tcPr>'+p(f'{kind} {mark} first',mark)+p(f'{kind} {mark} last',mark)+'</w:tc>'
 body+='</w:tr></w:tbl>'+p(f'After {kind} table')
body+=p('',24)+p('After empty large mark')
body+=p('Before spaces')+p('   ',24)+p('After spaces')
body+=p('TAB',24).replace('<w:t xml:space="preserve">TAB</w:t>','<w:tab/>')+p('After tab')
body+=p('Manual break',24).replace('</w:t>','</w:t><w:br/>')+p('After manual break')
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
with ZipFile(root/'public/fixtures/paragraph-mark-metrics.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
