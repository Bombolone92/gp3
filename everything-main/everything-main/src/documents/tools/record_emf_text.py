"""Record native glyph bounds independently of application rendering."""
from pathlib import Path
from hashlib import sha256
import json
import pypdfium2 as pdfium
ROOT=Path(__file__).resolve().parents[1]/'tests/fixtures/emf-text'
pdf=pdfium.PdfDocument(ROOT/'native.pdf');assert len(pdf)==1
page=pdf[0];text=page.get_textpage();height=page.get_height()
chars=[];started=False
for i in range(text.count_chars()):
 value=text.get_text_range(i,1)
 if value=='A':started=True
 if not started or value.isspace():continue
 left,bottom,right,top=text.get_charbox(i)
 chars.append(dict(text=value,left=left,top=height-top,right=right,bottom=height-bottom))
assert ''.join(c['text'] for c in chars)=='Ab&Ω'*8
cases=json.loads((ROOT/'cases.json').read_text())
for i,case in enumerate(cases):case['glyphs']=chars[i*4:i*4+4]
data=dict(referenceVersion='16.0.20326',sourceSha256=sha256((ROOT/'control.docx').read_bytes()).hexdigest(),pdfSha256=sha256((ROOT/'native.pdf').read_bytes()).hexdigest(),cases=cases)
(ROOT/'reference.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
