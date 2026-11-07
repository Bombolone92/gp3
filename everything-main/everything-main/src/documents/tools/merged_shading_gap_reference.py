"""Record native shaded spans through the original controls' right column."""
from pathlib import Path
import hashlib
import json
import sys
import pypdfium2 as pdf

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/merged-shading-gap'
paged = len(sys.argv) > 1 and sys.argv[1] == 'paged'
prefix = 'paged-' if paged else ''
source = 'paged.docx' if paged else 'control.docx'
cases = json.loads((folder / (prefix + 'cases.json')).read_text())
records = []
with pdf.PdfDocument(folder / (prefix + 'native.pdf')) as document:
    assert len(document) == len(cases)
    for index, case in enumerate(cases):
        page = document[index]
        image = page.render(scale=4).to_pil().convert('RGB')
        active = None
        spans = []
        for y in range(image.height + 1):
            red, green, blue = image.getpixel((1200,y)) if y < image.height else (255,255,255)
            ink = blue - red > 40 and green > red
            if ink and active is None:
                active = y
            if not ink and active is not None:
                spans.append([active / 4, y / 4]); active = None
        records.append(dict(**case, spans=spans))
        page.close()
record = dict(referenceVersion='16.0.20326', sourceSha256=hashlib.sha256((folder/source).read_bytes()).hexdigest(),
              pdfSha256=hashlib.sha256((folder/(prefix+'native.pdf')).read_bytes()).hexdigest(), cases=records)
(folder / (prefix + 'reference.json')).write_text(json.dumps(record, indent=2)+'\n')
print([(case['name'], case['spans']) for case in records])
