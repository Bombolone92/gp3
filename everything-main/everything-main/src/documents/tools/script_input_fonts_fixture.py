"""Original native insertion controls; no corpus content or font assets."""
from pathlib import Path
import json
from zipfile import ZipFile,ZIP_DEFLATED
repo=Path(__file__).resolve().parents[1]
root=repo/'tests/fixtures/script-input-fonts';root.mkdir(exist_ok=True)
with ZipFile(repo/'tests/fixtures/script-input/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases=[dict(flag=flag,text=text,font=font) for flag in ['cs','rtl'] for font in ['Arial','Segoe UI Historic','Times New Roman'] for text in ['𐤀','𐩠','𞤀','𐤀1','𐤀 1','𐤀א','א𐤀','𐤀𐤁𐤂','𐤀 A','A𐤀']]
body=[f'<w:p><w:r><w:rPr><w:rFonts w:ascii="{c["font"]}" w:hAnsi="{c["font"]}" w:cs="{c["font"]}"/><w:sz w:val="20"/><w:szCs w:val="32"/><w:{c["flag"]}/></w:rPr><w:t>AB</w:t></w:r></w:p>' for c in cases]
parts['word/document.xml']=f'<w:document xmlns:w="{w}"><w:body>{"".join(body)}<w:sectPr/></w:body></w:document>'.encode()
with ZipFile(root/'control.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(root/'cases.json').write_text(json.dumps(cases,ensure_ascii=False),encoding='utf-8')
