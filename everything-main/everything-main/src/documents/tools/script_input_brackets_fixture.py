"""Original native insertion controls; no corpus content or font assets."""
from pathlib import Path
import json
from zipfile import ZipFile,ZIP_DEFLATED
repo=Path(__file__).resolve().parents[1]
root=repo/'tests/fixtures/script-input-brackets';root.mkdir(exist_ok=True)
with ZipFile(repo/'tests/fixtures/script-input/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases=[dict(flag=flag,text=text) for flag in ['cs','rtl'] for text in ['ا(1)A','ا(1)','ا(1) ','ا[1]A','ا 1 A','ا-1A','ا(1)ا','A(1)ا','ا123A','ا.1A','ا(ا)A','ا(1)א','ا(1)中','ا(1)क','ا/1A','ا:1A','ا,1A','ا1A','א1A','א(1)A']]
body=[f'<w:p><w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="32"/><w:{c["flag"]}/></w:rPr><w:t>AB</w:t></w:r></w:p>' for c in cases]
parts['word/document.xml']=f'<w:document xmlns:w="{w}"><w:body>{"".join(body)}<w:sectPr/></w:body></w:document>'.encode()
with ZipFile(root/'control.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(root/'cases.json').write_text(json.dumps(cases,ensure_ascii=False),encoding='utf-8')
