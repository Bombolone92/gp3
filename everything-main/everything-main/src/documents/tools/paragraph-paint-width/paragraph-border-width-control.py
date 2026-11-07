from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from xml.sax.saxutils import escape
repo=Path(__file__).resolve().parents[2]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(repo/'public/fixtures/joined-border-spacing-15.docx') as z:parts={n:z.read(n) for n in z.namelist()}
def para(text,font='Arial',size=10,border=False,page=False):
 rpr=f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}"/><w:sz w:val="{size*2}"/>'
 pr='<w:pageBreakBefore/>' if page else ''
 if border:pr+='<w:pBdr>'+''.join(f'<w:{s} w:val="single" w:sz="2" w:space="10" w:color="0000FF"/>' for s in ['top','left','bottom','right'])+'</w:pBdr><w:shd w:val="clear" w:fill="228844"/>'
 pr+='<w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="exact"/>'
 if border:pr+='<w:ind w:left="720" w:right="720"/>'
 pr+=f'<w:rPr>{rpr}</w:rPr>'
 return f'<w:p><w:pPr>{pr}</w:pPr><w:r><w:rPr>{rpr}</w:rPr><w:t>{escape(text)}</w:t></w:r></w:p>'
body=''
cases=[('Arial',10),('Arial',16),('Arial',20),('Courier New',10),('Courier New',20),('Times New Roman',10),('Times New Roman',20),('Century Gothic',11),('Century Gothic',16)]
for i,(font,size) in enumerate(cases):
 name='Case'+str(i)
 body+=para(name+' '+font+' '+str(size),page=i>0)+para(name+'Body',font,size,True)
 margins=''.join(f'<w:{s} w:w="0" w:type="dxa"/>' for s in ['top','left','bottom','right'])
 body+=f'<w:tbl><w:tblPr><w:tblW w:w="4320" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4320"/></w:tblGrid><w:tr><w:tc><w:tcPr/>'+para(name+'Cell',font,size,True)+'</w:tc></w:tr></w:tbl>'+para(name+'End')
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
with ZipFile(repo/'public/fixtures/paragraph-border-width-control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
