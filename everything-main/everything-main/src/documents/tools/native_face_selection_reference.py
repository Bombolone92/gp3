"""Record native reference character origins for original font selection controls."""
from pathlib import Path
import pypdfium2 as pdf
import ctypes,json,hashlib
p=Path(__file__).resolve().parents[1]/'tests/fixtures/native-face-selection';d=pdf.PdfDocument(p/'native.pdf');assert len(d)==1;t=d[0].get_textpage();lines=[]
for i in range(t.count_chars()):
 c=t.get_text_range(i,1)
 if c in '\r\n':continue
 x,y=ctypes.c_double(),ctypes.c_double();pdf.raw.FPDFText_GetCharOrigin(t,i,ctypes.byref(x),ctypes.byref(y))
 if not lines or abs(lines[-1]['y']-y.value)>.1:lines.append(dict(y=y.value,chars=[]))
 lines[-1]['chars'].append(dict(text=c,x=x.value))
cases=json.loads((p/'cases.json').read_text(encoding='utf-8'));assert len(lines)==len(cases)
for case,line in zip(cases,lines):
 assert ''.join(c['text'] for c in line['chars']).strip()==case['text']
 chars=line['chars'][:len(case['text'])];case.update(advance=chars[-1]['x']-chars[0]['x'],baseline=792-line['y'])
(p/'reference.json').write_text(json.dumps(dict(sourceSha256=hashlib.sha256((p/'control.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((p/'native.pdf').read_bytes()).hexdigest(),cases=cases),indent=2)+'\n',encoding='utf-8')
