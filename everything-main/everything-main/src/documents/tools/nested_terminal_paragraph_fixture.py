"""Original controls for terminal empty paragraphs after a nested table."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(root/'public/fixtures/reviewed-font.docx') as z:parts={n:z.read(n) for n in z.namelist()}
def p(text='',line=18,gap=0):return f'<w:p><w:pPr><w:spacing w:before="{gap}" w:after="{gap}" w:line="{line*20}" w:lineRule="exact"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
def table(content,width=5760):return f'<w:tbl><w:tblPr><w:tblW w:w="{width}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>'+''.join(f'<w:{s} w:w="0" w:type="dxa"/>' for s in ['top','left','bottom','right'])+f'</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="{width}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/></w:tcPr>{content}</w:tc></w:tr></w:tbl>'
body=''
for label,ending in [('empty18',p()),('empty36spacing',p(line=36,gap=160)),('text18',p('Visible ending')),('twoempty',p()+p()),('spaces',p('   '))]:body+=p('Before '+label)+table(table(p('Nested '+label))+ending)+p('After '+label)
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
with ZipFile(root/'public/fixtures/nested-terminal-paragraph.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
