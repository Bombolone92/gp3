"""Record the native Times New Roman separator raster from the existing reference control."""
import hashlib
import json
import math
from pathlib import Path
import pypdfium2 as pdf

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/line-separator-fonts'
cases = json.loads((root / 'cases.json').read_text())
page_index = next(i for i, case in enumerate(cases) if case[0] == 'times')
document = pdf.PdfDocument(root / 'native.pdf')
page = document[page_index]
text = page.get_textpage()
indices = [i for i in range(text.count_chars()) if text.get_text_range(i, 1) == '\u2028']
if len(indices) != 1:
    raise ValueError('Expected one native separator glyph')
left, bottom, right, top = text.get_charbox(indices[0])
scale = 4
# Do not include the preceding sample's ink. Keep vertical/right whitespace.
box = [math.floor(left * scale), math.floor((page.get_height() - top) * scale) - 2,
       math.ceil(right * scale) + 2, math.ceil((page.get_height() - bottom) * scale) + 2]
image = page.render(scale=scale).to_pil().convert('RGB').crop(box)
points = [[x, y] for y in range(image.height) for x in range(image.width) if min(image.getpixel((x, y))) < 128]
if not points:
    raise ValueError('Empty native separator raster')
result = dict(pdfSha256=hashlib.sha256((root / 'native.pdf').read_bytes()).hexdigest(), page=page_index,
              pixelsPerPoint=scale, box=box, threshold=128, points=points)
(root / 'separator-ink.json').write_text(json.dumps(result, indent=2) + '\n')
print(f'Recorded {len(points)} native ink pixels in {image.width}x{image.height}')
