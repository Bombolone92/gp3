"""Record reference PDF character origins independently of the renderer."""
from pathlib import Path
import pypdfium2 as P
import ctypes as C
import hashlib
import json
import re
folder = Path(__file__).resolve().parents[1]/'tests/fixtures/cell-row-context'
records = {}
for name, pdf in [('control', 'native.pdf'), ('merge', 'merge-native.pdf')]:
    doc = P.PdfDocument(folder/pdf)
    lines = []
    for i, page in enumerate(doc):
        text = page.get_textpage()
        for label in re.findall(r'C\d+R\d+C\d+', text.get_text_range()):
            hit = text.search(label).get_next()
            x, y = C.c_double(), C.c_double()
            P.raw.FPDFText_GetCharOrigin(text, hit[0], C.byref(x), C.byref(y))
            lines.append(dict(text=label, page=i, x=x.value, y=page.get_height()-y.value))
    records[name] = dict(pages=len(doc), lines=lines, hashes={n:hashlib.sha256((folder/n).read_bytes()).hexdigest() for n in [name+'.docx',pdf]})
(folder/'reference.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
