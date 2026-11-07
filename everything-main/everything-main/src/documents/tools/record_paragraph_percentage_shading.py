"""Record native PDF colors/positions without consulting engine output."""
from pathlib import Path
import ctypes
import hashlib
import json
import pypdfium2 as pdf

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/paragraph-percentage-shading'
cases = json.loads((root/'cases.json').read_text())
records = []
for source, name in [('control.docx','native.pdf'),('dark.docx','dark-native.pdf')]:
    document = pdf.PdfDocument(root/name)
    rows = []
    for page_index, page in enumerate(document):
        text = page.get_textpage()
        image = page.render(scale=4).to_pil().convert('RGB')
        for index in range(text.count_chars()):
            label = text.get_text_range(index,3)
            case = next((c for c in cases if c['label']==label),None)
            if case is None:
                continue
            x,y = ctypes.c_double(),ctypes.c_double()
            assert pdf.raw.FPDFText_GetCharOrigin(text,index,ctypes.byref(x),ctypes.byref(y))
            sample_y = page.get_height()-y.value-3
            colors = {image.getpixel((2000+dx,round(sample_y*4)+dy)) for dx in range(-4,5) for dy in range(-4,5)}
            assert len(colors)==1,(label,colors)
            rows.append(dict(label=label,page=page_index,x=500,y=sample_y,rgb=list(colors.pop())))
    assert [r['label'] for r in rows]==[c['label'] for c in cases]
    records.append(dict(source=source,pdf=name,pages=len(document),rows=rows,
        sourceSha256=hashlib.sha256((root/source).read_bytes()).hexdigest(),
        pdfSha256=hashlib.sha256((root/name).read_bytes()).hexdigest()))
(root/'reference.json').write_text(json.dumps(records,indent=2)+'\n')
print('Recorded',sum(len(r['rows']) for r in records),'native colors')
