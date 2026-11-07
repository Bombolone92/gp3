"""Original XML page-border controls for independent sides and unequal widths."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/page-borders'
with ZipFile(folder/'control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';body=[]
cases=[['top'],['left'],['bottom'],['right'],['top','right'],['top','left','bottom','right']]
for i,sides in enumerate(cases):
 edges=''.join(f'<w:{side} w:val="single" w:sz="{[8,24,40,56][j] if i==5 else 48}" w:space="{[12,24,18,6][j] if i==5 else 24}" w:color="000000"/>' for j,side in enumerate(sides))
 section=f'<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:pgBorders w:offsetFrom="page">{edges}</w:pgBorders></w:sectPr>'
 body.append(f'<w:p><w:pPr>{section if i<5 else ""}</w:pPr><w:r><w:t>Case sides {i}</w:t></w:r></w:p>')
 if i==5:body.append(section)
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'
with ZipFile(folder/'sides.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
