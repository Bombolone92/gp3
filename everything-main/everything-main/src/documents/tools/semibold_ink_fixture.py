"""Original OOXML controls for real and synthesized font weights."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
base=Path(__file__).resolve().parents[1]/'public/fixtures/exhausted-cell-indents.docx'
with ZipFile(base) as z:parts={n:z.read(n) for n in z.namelist()}
paras=[]
for family in ['Franklin Gothic Demi','Arial Black','Arial Bold']:
 for size in [8,12,24]:
  for bold in [False,True]:
   label=f'{family} {size} '+('bold' if bold else 'regular')
   rp=f'<w:rFonts w:ascii="{family}" w:hAnsi="{family}"/>'+('<w:b/>' if bold else '')+f'<w:sz w:val="{size*2}"/>'
   paras.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr>{rp}</w:rPr><w:t>{label}</w:t></w:r></w:p>')
parts['word/document.xml']=(f'<w:document xmlns:w="{W}"><w:body>'+''.join(paras)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>').encode()
with ZipFile(Path(__file__).resolve().parents[1]/'tests/fixtures/semibold-ink/control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
