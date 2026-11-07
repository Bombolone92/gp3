"""Record native reference glyph positions and fonts without using the app renderer."""
from pathlib import Path
from hashlib import sha256
import ctypes
import json
import pypdfium2 as P
import pypdfium2.raw as R
root=Path(__file__).resolve().parents[1]/'tests/fixtures/rtl-runs'
pdf=P.PdfDocument(root/'native.pdf')
pages=[]
for page in pdf:
    text=page.get_textpage(); chars=[]
    for i in range(text.count_chars()):
        code=R.FPDFText_GetUnicode(text,i)
        if code<32:continue
        x=ctypes.c_double();y=ctypes.c_double()
        assert R.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y))
        font=ctypes.create_string_buffer(256);flags=ctypes.c_int()
        R.FPDFText_GetFontInfo(text,i,font,256,ctypes.byref(flags))
        chars.append(dict(text=chr(code),x=x.value,y=page.get_height()-y.value,
            font=font.value.decode('utf-8'),size=R.FPDFText_GetFontSize(text,i),weight=R.FPDFText_GetFontWeight(text,i)))
    pages.append(chars)
result=dict(referenceVersion='16.0.20326',pages=pages)
for name,key in [('control.docx','sourceSha256'),('native.pdf','pdfSha256'),('cases.json','casesSha256')]:result[key]=sha256((root/name).read_bytes()).hexdigest()
(root/'reference.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
