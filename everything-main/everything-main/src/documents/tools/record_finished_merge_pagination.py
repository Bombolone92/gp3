"""Record reference page assignment and text origins without using engine output."""
from pathlib import Path
import pypdfium2 as P
import ctypes as C
import hashlib, json
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/finished-merge-pagination'
cases=json.loads((folder/'cases.json').read_text(encoding='utf-8')); records={}
for case in cases:
    name=case['name']; doc=P.PdfDocument(folder/f'{name}.pdf'); lines=[]
    tokens=['Heading A','Heading B','Body A','Body B','After table']+[f'Merge {i+1}' for i in range(case['count'])]
    for pi,page in enumerate(doc):
        text=page.get_textpage()
        for token in tokens:
            search=text.search(token,match_whole_word=True); result=search.get_next()
            if result is None: continue
            x,y=C.c_double(),C.c_double();P.raw.FPDFText_GetCharOrigin(text,result[0],C.byref(x),C.byref(y))
            lines.append(dict(text=token,page=pi,x=x.value,y=page.get_height()-y.value))
    assert len(lines)==len(tokens),(name,lines)
    records[name]=dict(pages=len(doc),lines=lines,hashes={f'{name}{suffix}':hashlib.sha256((folder/f'{name}{suffix}').read_bytes()).hexdigest() for suffix in ['.docx','.pdf']})
(folder/'reference.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
