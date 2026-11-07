"""Original controls for a break paragraph at the page's writing edge."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(root/'public/fixtures/table-shading-scope.docx') as z:parts={n:z.read(n) for n in z.namelist()}
for kind in ['table','paragraph']:
    for height in [300,324]:
        if kind=='table':
            first=f'<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="{height*20}" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Before</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
        else:first=f'<w:p><w:pPr><w:spacing w:line="{height*20}" w:lineRule="exact"/></w:pPr><w:r><w:t>Before</w:t></w:r></w:p>'
        body=first+'<w:p><w:pPr><w:spacing w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>After</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="6000" w:h="8000"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
        parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
        with ZipFile(root/f'public/fixtures/terminal-break-{kind}-{height}.docx','w',ZIP_DEFLATED) as z:
            for n,d in parts.items():z.writestr(n,d)
with ZipFile(root/'public/fixtures/terminal-break-paragraph-324.docx') as z:parts={n:z.read(n) for n in z.namelist()}
for kind in ['leading','bordered']:
    xml=parts['word/document.xml'].decode()
    if kind=='leading':
        xml=xml.replace('<w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>After</w:t>', '<w:br w:type="page"/><w:t>After</w:t>')
    else:
        xml=xml.replace('<w:spacing w:line="240" w:lineRule="exact"/>','<w:pBdr><w:top w:val="single" w:sz="8" w:space="0"/><w:bottom w:val="single" w:sz="8" w:space="0"/></w:pBdr><w:spacing w:line="240" w:lineRule="exact"/>')
    with ZipFile(root/f'public/fixtures/terminal-break-{kind}-324.docx','w',ZIP_DEFLATED) as z:
        for n,d in parts.items():z.writestr(n,xml.encode() if n=='word/document.xml' else d)
