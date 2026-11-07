"""Extract line assignments from the independently exported reference PDF."""
from pathlib import Path
import ctypes, hashlib, json
import pypdfium2 as pdfium
root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/hyphen-wrap'
cases=json.loads((folder/'cases.json').read_text(encoding='utf-8'))
pdf=folder/'native.pdf'; doc=pdfium.PdfDocument(pdf)
assert len(doc)==len(cases)
for index,case in enumerate(cases):
    text=doc[index].get_textpage(); lines=[]; last_y=None
    for i in range(text.count_chars()):
        char=text.get_text_range(i,1)
        if char in '\r\n':continue
        x=ctypes.c_double(); y=ctypes.c_double()
        pdfium.raw.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y))
        if last_y is None or abs(y.value-last_y)>5:
            lines.append('');last_y=y.value
        # The reference's discretionary line-end ASCII hyphen has no Unicode PDF map.
        lines[-1]+= '-' if char=='\ufffe' else char
    assert lines.pop(0)==f'CASE {case["name"]}'
    case['lines']=[line.rstrip() for line in lines]
    # The reference PDF maps U+2011 to the same PDF glyph text as U+2010.
    assert ''.join(case['lines']).replace(' ','')==case['text'].replace('\u2011','\u2010').replace(' ','')
result=dict(sourceSha256=hashlib.sha256((root/'public/fixtures/hyphen-wrap.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),cases=cases)
(folder/'reference.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
