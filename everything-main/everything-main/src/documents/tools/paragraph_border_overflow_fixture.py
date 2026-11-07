"""Original cell clipping control; run automatic_spacing_fixture.py first."""
from zipfile import ZipFile,ZIP_DEFLATED
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
with ZipFile(ROOT/'public/fixtures/automatic-spacing-modern.docx') as z:parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
body='<w:tbl><w:tblPr><w:tblW w:w="5760" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>'+''.join(f'<w:{s} w:w="0" w:type="dxa"/>' for s in ['top','left','bottom','right'])+'</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid>'
for inset in [0,5,15]:
 body+='<w:tr><w:trPr><w:trHeight w:val="1440" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr/><w:p><w:pPr><w:pBdr>'+''.join(f'<w:{s} w:val="single" w:sz="16" w:space="10" w:color="0000FF"/>' for s in ['top','left','bottom','right'])+f'</w:pBdr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/><w:ind w:left="{inset*20}" w:right="{inset*20}"/></w:pPr><w:r><w:t>Inset{inset}</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:shd w:val="clear" w:fill="DDDDDD"/></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>Neighbor{inset}</w:t></w:r></w:p></w:tc></w:tr>'
body+='</w:tbl><w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
with ZipFile(ROOT/'public/fixtures/paragraph-border-overflow.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
