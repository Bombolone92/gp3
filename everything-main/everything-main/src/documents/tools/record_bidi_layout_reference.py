"""Record native line baselines and glyph origins independently of the renderer."""
from pathlib import Path
from hashlib import sha256
import ctypes,json
import pypdfium2 as P
import pypdfium2.raw as R
root=Path(__file__).resolve().parents[1]/'tests/fixtures/bidi-layout'
pages=[]
for page in P.PdfDocument(root/'native.pdf'):
    text=page.get_textpage();lines=[]
    for i in range(text.count_chars()):
        code=R.FPDFText_GetUnicode(text,i)
        if code<32:continue
        x,y=ctypes.c_double(),ctypes.c_double()
        assert R.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y))
        baseline=page.get_height()-y.value
        font=ctypes.create_string_buffer(256);flags=ctypes.c_int()
        R.FPDFText_GetFontInfo(text,i,font,256,ctypes.byref(flags))
        if not lines or abs(lines[-1]['baseline']-baseline)>.02:lines.append(dict(baseline=baseline,glyphs=[]))
        lines[-1]['glyphs'].append(dict(text=chr(code),x=x.value,font=font.value.decode()))
    pages.append(lines)
result=dict(referenceVersion='16.0.20326',pages=pages)
for name,key in [('control.docx','sourceSha256'),('native.pdf','pdfSha256'),('cases.json','casesSha256')]:result[key]=sha256((root/name).read_bytes()).hexdigest()
(root/'reference.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
