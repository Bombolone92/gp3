"""Record reference symbol advances, subtracting the following authored picture."""
from pathlib import Path
from zipfile import ZipFile
import ctypes
import hashlib
import json
from lxml import etree
import pypdfium2 as pdf

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/story-symbols'
with ZipFile(root / 'before-symbol.docx') as archive:
    widths = set()
    for part in ['word/document.xml', 'word/header1.xml', 'word/footer1.xml']:
        xml = etree.fromstring(archive.read(part))
        widths.update(int(n.get('cx')) / 12700 for n in xml.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}extent'))
assert len(widths) == 1
picture_width = widths.pop()
document = pdf.PdfDocument(root / 'native.pdf')
rows = []
for pi, page in enumerate(document):
    text = page.get_textpage()
    def point(index):
        x = ctypes.c_double(); y = ctypes.c_double()
        assert pdf.raw.FPDFText_GetCharOrigin(text, index, ctypes.byref(x), ctypes.byref(y))
        return x.value, page.get_height() - y.value
    for i in range(text.count_chars()):
        if pdf.raw.FPDFText_GetUnicode(text, i) != 0xf031:
            continue
        j = i + 1
        while j < text.count_chars() and text.get_text_range(j, 1) != 'A':
            j += 1
        assert text.get_text_range(j, 5) == 'After'
        symbol = point(i); following = point(j)
        assert abs(symbol[1] - following[1]) < .01
        rows.append(dict(label=text.get_text_range(i - 2, 2), page=pi, symbolX=symbol[0], baseline=symbol[1], afterPictureX=following[0], pictureWidth=picture_width, advance=following[0] - symbol[0] - picture_width))
assert sorted(r['label'] for r in rows) == ['10', '20', '30', '40']
data = dict(sourceSha256=hashlib.sha256((root / 'before-symbol.docx').read_bytes()).hexdigest(), pdfSha256=hashlib.sha256((root / 'native.pdf').read_bytes()).hexdigest(), pages=len(document), symbols=rows)
(root / 'reference.json').write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
print(f'Recorded {len(rows)} native symbol advances')
