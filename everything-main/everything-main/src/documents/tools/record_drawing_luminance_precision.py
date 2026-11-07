"""Record native reference swatch colors without consulting renderer output."""
from pathlib import Path
from hashlib import sha256
import json
import argparse
import pypdfium2 as pdfium

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory', nargs='?', type=Path, default=Path(__file__).resolve().parents[1] / 'tests/fixtures/drawing-luminance-precision')
ROOT = parser.parse_args().directory
cases = json.loads((ROOT / 'cases.json').read_text())
pdf = pdfium.PdfDocument(ROOT / 'native.pdf')
assert len(pdf) == 3
images = [page.render(scale=1).to_pil().convert('RGB') for page in pdf]
for case in cases:
    image = images[case['page']]
    pixels = [image.getpixel((case['x'] + dx, case['y'] + dy))
              for dx in [-10, 0, 10] for dy in [-10, 0, 10]]
    assert len(set(pixels)) == 1, case
    case['rgb'] = ''.join(f'{channel:02X}' for channel in pixels[0])
(ROOT / 'reference.json').write_text(json.dumps({
    'referenceVersion': '16.0.20326',
    'sourceSha256': sha256((ROOT / 'source.docx').read_bytes()).hexdigest(),
    'pdfSha256': sha256((ROOT / 'native.pdf').read_bytes()).hexdigest(),
    'cases': cases,
}, indent=2) + '\n')
print(f'Recorded {len(cases)} native swatches')
