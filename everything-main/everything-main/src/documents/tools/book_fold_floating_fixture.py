"""Independent booklet floating-table coordinate controls."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/book-fold'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(folder/'forward.docx') as z:parts={n:z.read(n) for n in z.namelist()}
body=[]
for page in range(4):
    body.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if page else ""}</w:pPr><w:r><w:t>Body {page+1}</w:t></w:r></w:p>')
    for i,base in enumerate(['margin','page']):
        body.append(f'<w:tbl><w:tblPr><w:tblpPr w:horzAnchor="{base}" w:vertAnchor="page" w:tblpX="600" w:tblpY="{2000+i*1600}"/><w:tblW w:w="1800" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="1800"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/><w:shd w:val="clear" w:fill="EEEEEE"/></w:tcPr><w:p><w:r><w:t>{base} {page+1}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')
        body.append('<w:p/>')
body.append('<w:sectPr><w:pgSz w:w="7920" w:h="12240" w:orient="landscape"/><w:pgMar w:top="720" w:right="1080" w:bottom="900" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'.encode()
with ZipFile(folder/'floating.docx','w',ZIP_DEFLATED) as z:
    for path,data in parts.items():
        info=ZipInfo(path,(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
