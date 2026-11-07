"""Original script-context insertion controls; no corpus content."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from xml.sax.saxutils import escape
import json
repo=Path(__file__).resolve().parents[1]
root=repo/'tests/fixtures/script-input';root.mkdir(exist_ok=True)
with ZipFile(repo/'tests/fixtures/script-size-commands/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases=[];body=[]
for flag in ['', 'cs','rtl']:
 for text in ['X','é','中','क','א','س','1','١',' ','(','.','-','Aא1','אA','س1','1س','ا ب','A B','🙂','\u0301','س A','A س','क1','क A','कא','אक','س\u0301','A\u0301','ס(א)','A(א)','ا(1)A','\t','\u200d','\u200f','\u200e','α','Ж','ก','ກ','ក','ཀ','က','ক','ਕ','ક','କ','க','క','ಕ','ക','ක','ᠠ','ܐ','ހ','ߊ','Ꭰ','ሀ','ა','ᜀ','ꦄ','ꢂ','𞤀','𐤀','𐩠','𑀅']:
  cases.append(dict(flag=flag,text=text))
  props='<w:sz w:val="20"/><w:szCs w:val="32"/>'+(f'<w:{flag}/>' if flag else '')
  body.append(f'<w:p><w:r><w:rPr>{props}</w:rPr><w:t>AB</w:t></w:r></w:p>')
parts['word/document.xml']=f'<w:document xmlns:w="{w}"><w:body>{"".join(body)}<w:sectPr/></w:body></w:document>'.encode()
with ZipFile(root/'control.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(root/'cases.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2),encoding='utf-8')
