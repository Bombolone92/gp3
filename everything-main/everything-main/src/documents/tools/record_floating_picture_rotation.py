"""Record native picture bounds and stable pixels from the reference PDF."""
from pathlib import Path
import hashlib, json, subprocess, tempfile
from PIL import Image, ImageChops
folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/floating-picture-rotation'
cases = json.loads((folder / 'cases.json').read_text())
with tempfile.TemporaryDirectory(prefix='floating-rotation-reference-') as temp:
    prefix = Path(temp) / 'page'
    subprocess.run(['pdftoppm', '-r', '288', '-png', str(folder / 'native.pdf'), str(prefix)], check=True)
    pages = [Image.open(prefix.with_name(f'page-{i}.png')).convert('RGB') for i in range(1, 4)]
# PDFium darkens constant colors under some affine image transforms by two
# levels. Poppler retains the PDF's original RGB values in those interiors.
for case in cases:
    im = pages[case['page']]
    l, t, r, b = case['x'] - 50, case['y'] - 70, case['x'] + 170, case['y'] + 130
    case['region'] = [l, t, r, b]
    samples = []
    for x in range(l + 3, r - 3, 6):
        for y in range(t + 3, b - 3, 6):
            color = im.getpixel((x * 4, y * 4))
            if all(im.getpixel((x * 4 + dx, y * 4 + dy)) == color for dx in range(-8, 9) for dy in range(-8, 9)):
                samples.append([x, y, *color])
    case['samples'] = samples
    crop = im.crop((l * 4, t * 4, r * 4, b * 4)); red, green, blue = crop.split()
    mask = ImageChops.subtract(ImageChops.lighter(ImageChops.lighter(red, green), blue), ImageChops.darker(ImageChops.darker(red, green), blue)).point(lambda n: 255 if n > 50 else 0)
    a, c, d, e = mask.getbbox(); case['bounds'] = [l + a / 4, t + c / 4, l + d / 4, t + e / 4]
reference = dict(sourceSha256=hashlib.sha256((folder / 'control.docx').read_bytes()).hexdigest(), pdfSha256=hashlib.sha256((folder / 'native.pdf').read_bytes()).hexdigest(), cases=cases)
(folder / 'reference.json').write_text(json.dumps(reference, separators=(',', ':')) + '\n')
print(sum(len(c['samples']) for c in cases), 'samples')
