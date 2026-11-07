"""Record native symbol advances independently of surrounding label shaping."""
from pathlib import Path
import ctypes
import json
import pypdfium2 as pdf
root=Path(__file__).resolve().parents[1]/'tests/fixtures/body-symbols'
cases=json.loads((root/'cases.json').read_text())
document=pdf.PdfDocument(root/'native.pdf')
rows=[]
for page_index,page in enumerate(document):
    text=page.get_textpage()
    def point(index):
        x=ctypes.c_double();y=ctypes.c_double()
        if not pdf.raw.FPDFText_GetCharOrigin(text,index,ctypes.byref(x),ctypes.byref(y)):
            raise RuntimeError('Missing native character origin')
        return x.value,page.get_height()-y.value
    for index in range(text.count_chars()):
        label=text.get_text_range(index,3)
        if label not in [case['label'] for case in cases]:continue
        end=index+6
        while end<text.count_chars() and text.get_text_range(end,1)!='R':end+=1
        origin=point(index);symbol=point(index+5);right=point(end)
        rows.append(dict(label=label,page=page_index,x=origin[0],baseline=origin[1],symbolX=symbol[0],rightX=right[0]))
if [row['label'] for row in rows]!=[case['label'] for case in cases]:
    raise RuntimeError('Native labels differ from case inventory')
(root/'native-positions.json').write_text(json.dumps(rows,indent=2)+'\n')
print(f'Recorded {len(rows)} symbol positions')
