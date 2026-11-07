"""Original manual OOXML controls for authored hyphen break opportunities."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from html import escape
import json
root=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(root/'public/fixtures/table-shading-scope.docx') as z:parts={n:z.read(n) for n in z.namelist()}
cases=[
 ('ascii',110,'We favor forward-thinking plans.'),
 ('unicode',110,'We favor forward\u2010thinking plans.'),
 ('nonbreaking',110,'We favor forward\u2011thinking plans.'),
 ('leading',80,'We favor -thinking plans.'),
 ('numeric',80,'Alpha 123-456789 delta'),
 ('short',70,'One two A-B finish'),
 ('double',65,'One two --tail finish'),
 ('negative',65,'One two -123456 end'),
 ('minus',70,'One two a\u2212b finish'),
 ('split-run',110,'We favor forward-thinking plans.'),
]
body=[]
for i,(name,width,text) in enumerate(cases):
    body.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i else ""}</w:pPr><w:r><w:t>CASE {name}</w:t></w:r></w:p>')
    chunks=text.split('-') if name=='split-run' else [text]
    if name=='split-run':chunks=[chunks[0],'-',chunks[1]]
    runs=''.join(f'<w:r><w:t xml:space="preserve">{escape(s)}</w:t></w:r>' for s in chunks)
    body.append(f'<w:p><w:pPr><w:spacing w:line="360" w:lineRule="exact"/><w:ind w:right="{(504-width)*20}"/></w:pPr>{runs}</w:p>')
body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'.encode()
with ZipFile(root/'public/fixtures/hyphen-wrap.docx','w',ZIP_DEFLATED) as z:
    for n,d in parts.items():z.writestr(n,d)
folder=root/'tests/fixtures/hyphen-wrap';folder.mkdir(exist_ok=True)
(folder/'cases.json').write_text(json.dumps([dict(name=n,width=w,text=t) for n,w,t in cases],ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
