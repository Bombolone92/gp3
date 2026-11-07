"""Original font-name whitespace controls; source spellings are intentional."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from xml.sax.saxutils import escape
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(ROOT/'public/fixtures/reviewed-font.docx') as z:parts={n:z.read(n) for n in z.namelist()}
names=['Arial','Arial ',' Arial','  Arial  ','Times New Roman','Times New Roman ','Courier New','Courier New ','Arial  ','Arial\u00a0','Arial','Arial ']
body=[]
for i,name in enumerate(names):
 font=f'<w:rFonts w:ascii="{escape(name)}" w:hAnsi="{escape(name)}"/>'+('<w:b/><w:i/>' if i>=10 else '')+'<w:sz w:val="28"/>'
 text='Whitespace font control: MWiii 0123456789 alpha beta.'
 body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="120" w:line="288" w:lineRule="auto"/><w:rPr>{font}</w:rPr></w:pPr><w:r><w:rPr>{font}</w:rPr><w:t>{text}</w:t></w:r></w:p>')
section='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}{section}</w:body></w:document>'.encode()
with ZipFile(ROOT/'public/fixtures/font-name-spaces.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
