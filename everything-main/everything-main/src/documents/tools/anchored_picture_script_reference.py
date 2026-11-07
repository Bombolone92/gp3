"""Measure the original picture controls from a captured native reference PDF.

Record native.pdf with tools/export-reference.ps1 before running this script.
The native application version is recorded with the capture.
"""
from pathlib import Path
import hashlib
import json
import pypdfium2 as pdf
from PIL import ImageChops

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/anchored-picture-script'
cases = json.loads((folder / 'cases.json').read_text())
records = []
with pdf.PdfDocument(folder / 'native.pdf') as document:
    assert len(document) == len(cases)
    for index, case in enumerate(cases):
        page = document[index]
        image = page.render(scale=4).to_pil().convert('RGB')
        red, green, blue = image.split()
        maximum = ImageChops.lighter(ImageChops.lighter(red, green), blue)
        minimum = ImageChops.darker(ImageChops.darker(red, green), blue)
        mask = ImageChops.subtract(maximum, minimum).point(lambda value: 255 if value > 60 else 0)
        bounds = mask.getbbox()
        assert bounds is not None, case['name']
        records.append(dict(**case, bounds=[value / 4 for value in bounds],
                            pixelsSha256=hashlib.sha256(image.crop(bounds).tobytes()).hexdigest()))
        page.close()
record = dict(referenceVersion='16.0.20326',
              sourceSha256=hashlib.sha256((folder / 'control.docx').read_bytes()).hexdigest(),
              pdfSha256=hashlib.sha256((folder / 'native.pdf').read_bytes()).hexdigest(), cases=records)
(folder / 'reference.json').write_text(json.dumps(record, indent=2) + '\n')
print([(case['name'], case['bounds']) for case in records])
