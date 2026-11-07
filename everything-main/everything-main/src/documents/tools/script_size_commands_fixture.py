"""Original OOXML controls for the native font-size command and displayed size."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
import json

repo = Path(__file__).resolve().parents[1]
root = repo / 'tests/fixtures/script-size-commands'
root.mkdir(exist_ok=True)
w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(repo / 'tests/fixtures/script-format-commands/control.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
cases = []
for text, flag in [('Latin',''),('Latin','cs'),('Latin','rtl'),('אבגד',''),('אבגד','rtl'),('سلام',''),('سلام','rtl'),('1234','rtl'),('٠١٢٣','rtl')]:
    cases.append([dict(text=text, flag=flag, size=10, sizeCs=16)])
for flags, sizes in [(['',''],[(10,16),(14,20)]), (['cs','cs'],[(10,16),(14,20)]), (['rtl','rtl'],[(10,16),(14,20)]), (['','cs'],[(10,16),(10,16)]), (['','rtl'],[(10,16),(10,16)]), (['','cs'],[(16,10),(10,16)]), (['cs','rtl'],[(10,16),(14,16)]), (['',''],[(10,16),(10,20)])]:
    cases.append([dict(text=text, flag=flag, size=size, sizeCs=sizeCs) for text,flag,(size,sizeCs) in zip(['Left','Right'],flags,sizes)])
body = []
for runs in cases:
    xml = []
    for r in runs:
        props = f'<w:sz w:val="{r["size"]*2}"/><w:szCs w:val="{r["sizeCs"]*2}"/>'
        if r['flag']: props += f'<w:{r["flag"]}/>'
        xml.append(f'<w:r><w:rPr>{props}</w:rPr><w:t>{escape(r["text"])}</w:t></w:r>')
    body.append('<w:p>'+''.join(xml)+'</w:p>')
parts['word/document.xml'] = f'<w:document xmlns:w="{w}"><w:body>{"".join(body)}<w:sectPr/></w:body></w:document>'.encode()
with ZipFile(root / 'control.docx','w',ZIP_DEFLATED) as z:
    for n,data in parts.items(): z.writestr(n,data)
(root/'cases.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
