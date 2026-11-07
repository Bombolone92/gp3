"""Record native PDF text origins, independent of editor output."""
from pathlib import Path
import ctypes, hashlib, json
from collections import defaultdict
import pypdfium2 as pdf
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/compound-row-rounding-medium-small'
document=pdf.PdfDocument(str(folder/'native.pdf'));positions=[]
for pi in range(len(document)):
    page=document[pi];text=page.get_textpage();lines=defaultdict(list)
    for i in range(text.count_chars()):
        c=text.get_text_range(i,1)
        if not c.strip():continue
        x,y=ctypes.c_double(),ctypes.c_double()
        pdf.raw.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y))
        lines[round(page.get_height()-y.value,4)].append(c)
    for y,chars in lines.items():
        label=''.join(chars)
        if label.startswith('Case'):positions.append(dict(page=pi,text=label,y=y))
result=dict(sourceSha256=hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),positions=positions)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
print('Recorded',len(positions),'native PDF row baselines')
