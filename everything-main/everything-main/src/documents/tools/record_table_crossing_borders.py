"""Record black-line cross-junction regions independently from the reference PDF."""
from pathlib import Path
import hashlib
import json
import pypdfium2 as pdfium

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/table-crossing-borders'
pdf = pdfium.PdfDocument(folder / 'native.pdf')
image = pdf[0].render(scale=4).to_pil().convert('RGB')
groups = []
colored_groups = []
for y in range(image.height):
    pixels = [image.getpixel((x, y)) for x in range(320, 1040)]
    count = sum(max(pixel) < 250 for pixel in pixels)
    if count > 680:
        if not groups or y > groups[-1][-1] + 1:
            groups.append([])
        groups[-1].append(y)
    if sum(min(pixel) < 200 for pixel in pixels) > 680:
        if not colored_groups or y > colored_groups[-1][-1] + 1:
            colored_groups.append([])
        colored_groups[-1].append(y)
crossings = []
for rows in groups:
    y = (rows[0] + rows[-1] + 1) / 8
    dark = sum(max(image.getpixel((x, j))) < 200
               for j in range(int((y-1)*4), int((y+1)*4))
               for x in range(1144, 1160))
    crossings.append(dict(rect=[286, y-1, 4, 2], dark=dark))
assert len(crossings) == 2 and all(c['dark'] == 0 for c in crossings)
assert len(colored_groups) == 10
samples = []
for rows in colored_groups:
    y = (rows[0] + rows[-1] + 1) / 8
    samples.append(dict(x=288, y=y, color=image.getpixel((1152, int(y*4)))))
# The final white horizontal rules appear as gaps in the black vertical stroke.
vertical = []
for y in range(colored_groups[-1][-1] + 40, image.height):
    if max(image.getpixel((1152, y))) < 100:
        if not vertical or y > vertical[-1][-1] + 1:
            vertical.append([])
        vertical[-1].append(y)
vertical = [rows for rows in vertical if len(rows) > 20]
assert len(vertical) == 3
for first, second in zip(vertical, vertical[1:]):
    y = (first[-1] + second[0] + 1) / 8
    samples.append(dict(x=288, y=y, color=image.getpixel((1152, int(y*4)))))
result = dict(
    sourceSha256=hashlib.sha256((root / 'public/fixtures/table-crossing-borders.docx').read_bytes()).hexdigest(),
    pdfSha256=hashlib.sha256((folder / 'native.pdf').read_bytes()).hexdigest(),
    blackCrossings=crossings,
    samples=samples,
)
(folder / 'reference.json').write_text(json.dumps(result, indent=2) + '\n')
