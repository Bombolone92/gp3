"""Extract independent reference baselines for original cell-boundary controls."""
from pathlib import Path
import ctypes, hashlib, json
import pypdfium2 as pdfium

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/cell-end-context'
result = {}
for name in ['control', 'default', 'id', 'name']:
    pdf = pdfium.PdfDocument(folder / f'{name}-native.pdf')
    lines = []
    for index, page in enumerate(pdf):
        textpage = page.get_textpage()
        text = textpage.get_text_range()
        for label in ['Cell first', 'Cell last', 'After table', 'Body marker']:
            at = text.find(label)
            if at < 0:
                continue
            x, y = ctypes.c_double(), ctypes.c_double()
            pdfium.raw.FPDFText_GetCharOrigin(textpage, at, ctypes.byref(x), ctypes.byref(y))
            lines.append(dict(page=index, text=label, x=x.value, y=page.get_height()-y.value))
    result[name] = dict(pages=len(pdf), lines=lines, hashes={
        file: hashlib.sha256((folder/file).read_bytes()).hexdigest()
        for file in [f'{name}.docx', f'{name}-native.pdf']})
(folder/'reference.json').write_text(json.dumps(result, indent=2)+'\n')
