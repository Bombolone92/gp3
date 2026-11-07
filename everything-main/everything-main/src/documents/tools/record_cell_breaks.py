"""Record independent reference output for the original cell-break controls."""
from pathlib import Path
import ctypes, hashlib, json
import pypdfium2 as pdfium
from PIL import Image
root = Path(__file__).resolve().parents[1] / 'tests/fixtures/cell-breaks'
records = []
for source in sorted(root.glob('*.docx')):
    native = source.with_name(source.stem + '-native.pdf')
    pdf = pdfium.PdfDocument(str(native))
    pages = []
    for index in range(len(pdf)):
        page = pdf[index]
        text = page.get_textpage()
        full = text.get_text_range()
        labels = []
        for label in ['Before', 'After', 'Other cell', 'Next row', 'Other next row', 'After table']:
            index = full.find(label)
            if index < 0:
                continue
            x, y = ctypes.c_double(), ctypes.c_double()
            pdfium.raw.FPDFText_GetCharOrigin(text, index, ctypes.byref(x), ctypes.byref(y))
            labels.append({'text': label, 'x': x.value, 'baseline': page.get_height()-y.value})
        png = source.with_name(f'{source.stem}-native-{index+1}.png')
        bitmap = page.render(scale=2)
        bitmap.to_pil().convert('RGB').resize((816,1056),Image.Resampling.BOX).save(png)
        pages.append({'page': index+1, 'text': full, 'labels': labels, 'png': png.name,
                      'sha256': hashlib.sha256(png.read_bytes()).hexdigest()})
        bitmap.close()
        text.close()
        page.close()
    records.append({'source': source.name, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                    'pdfSha256': hashlib.sha256(native.read_bytes()).hexdigest(), 'pages': pages})
    pdf.close()
(root/'reference.json').write_text(json.dumps({'referenceVersion':'16.0.20326','cases':records},indent=2)+'\n',encoding='utf-8')
