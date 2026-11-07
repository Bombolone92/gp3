"""Original fixed-grid spacer with exactly 15 twips of paragraph writing space."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
with ZipFile(root/'public/fixtures/table-shading-scope.docx') as z:parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
widths=[4920,361,4920]
cells=''.join(f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/><w:shd w:val="clear" w:fill="{color}"/></w:tcPr><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc>' for width,color,text in zip(widths,['EEEEEE','22AA88','EEEEEE'],['Left','','Right']))
parts['word/document.xml']=f'''<w:document xmlns:w="{W}"><w:body>
<w:p><w:r><w:t>Exact one-pixel writing space</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblW w:w="{sum(widths)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="173" w:type="dxa"/><w:right w:w="173" w:type="dxa"/></w:tblCellMar></w:tblPr>
<w:tblGrid>{''.join(f'<w:gridCol w:w="{w}"/>' for w in widths)}</w:tblGrid><w:tr>{cells}</w:tr></w:tbl>
<w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1008" w:right="1008" w:bottom="1008" w:left="1008" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>
</w:body></w:document>'''.encode()
with ZipFile(root/'public/fixtures/narrow-cell-roundoff.docx','w',ZIP_DEFLATED) as z:
 for n,d in parts.items():z.writestr(n,d)
