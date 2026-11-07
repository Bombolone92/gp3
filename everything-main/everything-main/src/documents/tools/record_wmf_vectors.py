"""Record stable native reference pixels; no expected colors are supplied by the engine."""
from pathlib import Path
import hashlib, json, argparse
import pypdfium2 as pdf
parser = argparse.ArgumentParser()
parser.add_argument('--folder', default='wmf-vectors')
args = parser.parse_args()
folder = Path(__file__).resolve().parents[1] / 'tests/fixtures' / args.folder
document = pdf.PdfDocument(folder / 'native.pdf')
assert len(document) == 1
image = document[0].render(scale=4).to_pil().convert('RGB')
samples = []
for i in range(8):
    x, y = 60 + 260 * (i % 2), 100 + 140 * (i // 2)
    for dx in range(0, 201, 3):
        for dy in range(0, 91, 3):
            px, py = 4 * (x + dx), 4 * (y + dy)
            color = image.getpixel((px, py))
            if all(image.getpixel((px + a, py + b)) == color for a in range(-4, 5) for b in range(-4, 5)):
                samples.append(dict(x=x + dx, y=y + dy, color=list(color)))
reference = dict(sourceSha256=hashlib.sha256((folder / 'control.docx').read_bytes()).hexdigest(),
                 pdfSha256=hashlib.sha256((folder / 'native.pdf').read_bytes()).hexdigest(), samples=samples)
(folder / 'reference.json').write_text(json.dumps(reference, separators=(',', ':')) + '\n')
print(len(samples), 'native samples')
