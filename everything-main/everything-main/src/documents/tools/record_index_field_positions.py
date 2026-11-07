"""Extract the eight independently captured native line origins."""
from pathlib import Path
import ctypes
import json
import pypdfium2 as pdf

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/content-control-index-fields'
document = pdf.PdfDocument(root / 'native.pdf')
assert len(document) == 1
page = document[0]
text = page.get_textpage()
rows = []
for i in range(text.count_chars()):
    label = text.get_text_range(i, 3)
    if label not in [f'C{n:02}' for n in range(1, 9)]:
        continue
    x, y = ctypes.c_double(), ctypes.c_double()
    assert pdf.raw.FPDFText_GetCharOrigin(text, i, ctypes.byref(x), ctypes.byref(y))
    rows.append(dict(label=label, x=x.value, baseline=page.get_height()-y.value))
assert len(rows) == 8
(root / 'native-positions.json').write_text(json.dumps(rows, indent=2)+'\n')
