"""Extract text origins from the native reference exports of our collision controls."""
from pathlib import Path
import ctypes, hashlib, json, sys
import pypdfium2 as pdf

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/table-overlap'
name=sys.argv[1]
cases=json.loads((folder/(name+'-cases.json')).read_text())
pages=[]
for page in pdf.PdfDocument(folder/(name+'-native.pdf')):
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
assert len(pages)==len(cases)
result=dict(cases=cases,pages=pages,sourceSha256=hashlib.sha256((folder/(name+'.docx')).read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/(name+'-native.pdf')).read_bytes()).hexdigest())
(folder/(name+'-reference.json')).write_text(json.dumps(result,indent=2)+'\n')
