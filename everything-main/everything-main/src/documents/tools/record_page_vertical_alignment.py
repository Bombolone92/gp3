"""Record the installed reference application's page-alignment text origins, preserving source hashes."""
from pathlib import Path
import ctypes, hashlib, json, sys
import pypdfium2 as pdf

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/page-vertical-alignment'
name=sys.argv[1] if len(sys.argv)>1 else 'control'
prefix='' if name=='control' else name+'-'
cases=json.loads((folder/(prefix+'cases.json')).read_text())
pages=[]
for page in pdf.PdfDocument(folder/(prefix+'native.pdf')):
    text=page.get_textpage();lines=[]
    for i in range(text.count_chars()):
        c=text.get_text_range(i,1)
        if c.isspace():continue
        x,y=ctypes.c_double(),ctypes.c_double()
        pdf.raw.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y))
        top=page.get_height()-y.value
        if not lines or abs(lines[-1]['y']-top)>.2:lines.append(dict(text='',x=x.value,y=top))
        lines[-1]['text']+=c
    pages.append(lines)
assert len(pages)==sum(c['pages'] for c in cases)
result=dict(referenceVersion='16.0.20326',sourceSha256=hashlib.sha256((folder/(name+'.docx')).read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/(prefix+'native.pdf')).read_bytes()).hexdigest(),pages=pages)
(folder/(prefix+'reference.json')).write_text(json.dumps(result,indent=2)+'\n')
at=0
for c in cases:
    print(c['alignment'],c.get('kind',c.get('position')),pages[at:at+c['pages']]);at+=c['pages']
