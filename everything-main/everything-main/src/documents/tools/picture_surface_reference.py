"""Record samples from the independently exported reference PDF (never from canvas)."""
from pathlib import Path
import hashlib
import json
import sys
import pypdfium2 as pdf
from pypdf import PdfReader

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/picture-surfaces'
backing = '--backing-only' in sys.argv
source = 'backing.docx' if backing else 'source.docx'
pdf_name = 'backing.pdf' if backing else 'native.pdf'
cases = json.loads((folder / ('backing-cases.json' if backing else 'cases.json')).read_text(encoding='utf-8'))
document = pdf.PdfDocument(folder / pdf_name)
text = PdfReader(folder / pdf_name)
assert len(document) == len(cases) == len(text.pages)
points = {'transparent': [120, 150], 'halfAlpha': [210, 150],
          'blue': [310, 150], 'yellow': [310, 310]}
if backing: points.update(cropMargin=[85, 300], corner=[85, 115])
reference = {
    'referenceVersion': '16.0.20326',
    'sourceSha256': hashlib.sha256((folder / source).read_bytes()).hexdigest(),
    'pdfSha256': hashlib.sha256((folder / pdf_name).read_bytes()).hexdigest(),
    'dpi': 144,
    'samplePixels': points,
    'pages': [],
}
for index, (name, settings) in enumerate(cases):
    assert text.pages[index].extract_text().strip() == name
    image = document[index].render(scale=2).to_pil().convert('RGB')
    reference['pages'].append({'name': name, 'size': image.size,
                              'samples': {key: image.getpixel(tuple(pos)) for key, pos in points.items()}})
samples = [p['samples'] for p in reference['pages']]
assert samples[0] == samples[1]  # white backing on white paper
assert samples[2]['transparent'] != samples[0]['transparent']
assert samples[2]['blue'] == samples[0]['blue']  # backing does not tint opaque pixels
assert samples[2]['halfAlpha'] != samples[0]['halfAlpha']
if not backing:
    assert samples[4]['blue'] != samples[0]['blue']  # scene lighting affects front texture
    assert samples[5]['blue'] != samples[4]['blue']
(folder / ('backing-reference.json' if backing else 'reference.json')).write_text(json.dumps(reference, indent=2)+'\n', encoding='utf-8')
print(json.dumps(reference, indent=2))
