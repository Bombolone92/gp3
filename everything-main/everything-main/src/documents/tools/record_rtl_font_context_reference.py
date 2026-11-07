"""Extract native font/size/weight and glyph geometry for original controls."""
from pathlib import Path
from hashlib import sha256
import ctypes,json
import pypdfium2 as P
import pypdfium2.raw as R
root=Path(__file__).resolve().parents[1]/'tests/fixtures/rtl-font-context'
cases=json.loads((root/'cases.json').read_text(encoding='utf-8'))
pages=[];samples=[]
for pi,page in enumerate(P.PdfDocument(root/'native.pdf')):
    text=page.get_textpage();glyphs=[]
    for i in range(text.count_chars()):
        code=R.FPDFText_GetUnicode(text,i)
        if code<32:continue
        x,y=ctypes.c_double(),ctypes.c_double()
        assert R.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y))
        name=ctypes.create_string_buffer(256);flags=ctypes.c_int()
        R.FPDFText_GetFontInfo(text,i,name,256,ctypes.byref(flags))
        if not name.value:continue
        glyphs.append(dict(text=chr(code),x=x.value,baseline=page.get_height()-y.value,
            font=name.value.decode().split('+')[-1],size=R.FPDFText_GetFontSize(text,i),weight=R.FPDFText_GetFontWeight(text,i)))
    ys=sorted(set(round(g['baseline'],2) for g in glyphs))
    for c in [c for c in cases if c['page']==pi]:
        baseline=ys[c['index']%7*2+1]
        samples.append(dict(index=c['index'],baseline=baseline,glyphs=[g for g in glyphs if abs(g['baseline']-baseline)<.02]))
    pages.append(glyphs)
data=dict(referenceVersion='16.0.20326',samples=samples,pages=pages)
for n,k in [('control.docx','sourceSha256'),('native.pdf','pdfSha256'),('cases.json','casesSha256')]:data[k]=sha256((root/n).read_bytes()).hexdigest()
(root/'reference.json').write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
for c,s in zip(cases,samples):
    print(c['index'],c['text'],c['flag'],len(c['parts']),[(g['text'],g['font']) for g in s['glyphs'] if g['size']>15 and g['text']!=' '])
