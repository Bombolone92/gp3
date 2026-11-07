"""Bind native reference PDF geometry to independently authored hard-break sources."""
from pathlib import Path
import ctypes, hashlib, json
import pypdfium2 as pdfium

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/positioned-breaks'
hash_file = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
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
        for label in ['Healthy heading', 'Before break', 'After break', 'Healthy ending']:
            at = full.find(label)
            if at < 0:
                continue
            x, y = ctypes.c_double(), ctypes.c_double()
            pdfium.raw.FPDFText_GetCharOrigin(text, at, ctypes.byref(x), ctypes.byref(y))
            labels.append({'text': label, 'x': x.value, 'baseline': page.get_height() - y.value})
        pictures = []
        for obj in page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_IMAGE]):
            left, bottom, right, top = obj.get_bounds()
            pictures.append({'x': left, 'y': page.get_height() - top, 'width': right-left, 'height': top-bottom})
        png = source.with_name(f'{source.stem}-native-{index+1}.png')
        bitmap = page.render(scale=1.5)
        bitmap.to_pil().save(png)
        bitmap.close()
        pages.append({'page': index, 'labels': labels, 'pictures': pictures, 'png': png.name, 'pngSha256': hash_file(png)})
        text.close(); page.close()
    records.append({'source': source.name, 'sourceSha256': hash_file(source), 'pdfSha256': hash_file(native), 'pages': pages})
    pdf.close()
(root / 'reference.json').write_text(json.dumps({'referenceBuild': '16.0.20326', 'cases': records}, indent=2) + '\n', encoding='utf-8')
