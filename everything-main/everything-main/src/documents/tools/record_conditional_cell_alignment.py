"""Record reference cell text origins independently from the application."""
from pathlib import Path
import pypdfium2 as P
import ctypes as C
import json, hashlib
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/conditional-cell-alignment'
records={}
for mode in [12,14,15]:
    lines=[];doc=P.PdfDocument(folder/f'mode{mode}.pdf')
    for i,page in enumerate(doc):
        text=page.get_textpage()
        for row in range(2):
            for column in range(2):
                label=f'C{i:02d}R{row}C{column}';hit=text.search(label).get_next();assert hit is not None
                x,y=C.c_double(),C.c_double();P.raw.FPDFText_GetCharOrigin(text,hit[0],C.byref(x),C.byref(y))
                lines.append(dict(text=label,page=i,row=row,column=column,x=x.value,y=page.get_height()-y.value))
    records[str(mode)]=dict(pages=len(doc),lines=lines,hashes={f'mode{mode}{suffix}':hashlib.sha256((folder/f'mode{mode}{suffix}').read_bytes()).hexdigest() for suffix in ['.docx','.pdf']})
(folder/'reference.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
