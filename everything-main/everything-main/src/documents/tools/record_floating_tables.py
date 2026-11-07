"""Measure original native reference controls; no renderer-derived expectations."""
from pathlib import Path
import hashlib
import json
import pypdfium2 as pdfium
from PIL import ImageChops

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/floating-tables'
cases = json.loads((folder / 'cases.json').read_text())
pdf = pdfium.PdfDocument(folder / 'native.pdf')
assert len(pdf) == len(cases), (len(pdf), len(cases))
records = []
for index, case in enumerate(cases):
    page = pdf[index]
    bitmap = page.render(scale=4)
    picture = bitmap.to_pil().convert('RGB')
    r, g, b = picture.split()
    mask = ImageChops.multiply(r.point(lambda v: 255 if v > 180 else 0),
           ImageChops.multiply(g.point(lambda v: 255 if v < 80 else 0), b.point(lambda v: 255 if v < 100 else 0)))
    bounds = mask.getbbox()
    assert bounds, case['name']
    text = page.get_textpage()
    phrases = {}
    for phrase in ['Before table.', 'Anchor paragraph.', 'Following paragraph.']:
        search = text.search(phrase)
        found = search.get_next()
        assert found, (case['name'], phrase)
        start, count = found
        boxes = [text.get_charbox(n) for n in range(start, start + count)]
        phrases[phrase] = [min(b[0] for b in boxes), page.get_height() - max(b[3] for b in boxes),
                           max(b[2] for b in boxes), page.get_height() - min(b[1] for b in boxes)]
        search.close()
    records.append({**case, 'page': index + 1, 'tableInkBounds': [v / 4 for v in bounds], 'paragraphInkBounds': phrases})
    text.close()
    bitmap.close()
    page.close()
result = {'units': 'points from page top-left; table ink sampled at 4 pixels per point',
          'sourceSha256': hashlib.sha256((folder / 'floating-tables.docx').read_bytes()).hexdigest(),
          'pdfSha256': hashlib.sha256((folder / 'native.pdf').read_bytes()).hexdigest(), 'cases': records}
(folder / 'reference.json').write_text(json.dumps(result, indent=2) + '\n')
for record in records: print(record['name'], record['tableInkBounds'], record['paragraphInkBounds']['Anchor paragraph.'])
