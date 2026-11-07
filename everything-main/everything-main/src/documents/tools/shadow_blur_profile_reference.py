"""Record native reference shadow alpha and physical center-line samples."""
from pathlib import Path
import hashlib, json, math
import pypdfium2 as pdf
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/shadow-blur-profile'
cases = json.loads((folder / 'cases.json').read_text())
reader = PdfReader(folder / 'native.pdf')
document = pdf.PdfDocument(folder / 'native.pdf')
assert len(reader.pages) == len(cases)
pages = []
for i, case in enumerate(cases):
    page = reader.pages[i]
    assert page.extract_text().strip() == case['name']
    transforms = []
    page.extract_text(visitor_operand_before=lambda op, args, cm, tm:
                      transforms.append(list(cm)) if op == b'Do' else None)
    shadow = page.images[0].image
    assert shadow.mode == 'RGBA'
    matrix = transforms[0]
    texel = abs(matrix[0]) / shadow.width
    center_alpha = [shadow.getpixel((x, shadow.height//2))[3] for x in range(shadow.width)]
    im = document[i].render(scale=4).to_pil().convert('RGB')
    samples = []
    radius = math.ceil((texel + .375)*4)
    size, blur = case['sizePt'], case['blurPt']
    for offset in range(-blur-4, size+blur+5, 2):
        for x, y in ((288+offset, 100+size/2), (288+size/2, 100+offset)):
            px, py = round(x*4), round(y*4)
            values = [im.getpixel((px+dx, py+dy))[0]
                      for dx in range(-radius, radius+1)
                      for dy in range(-radius, radius+1)]
            samples.append([x, y, min(values), max(values)])
    pages.append(dict(**case, shadowPixels=list(shadow.size), shadowMatrix=matrix,
                      shadowTexelPt=texel, centerAlpha=center_alpha, samples=samples))
ref = dict(sourceSha256=hashlib.sha256((folder/'source.docx').read_bytes()).hexdigest(),
           pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(), pages=pages)
(folder/'reference.json').write_text(json.dumps(ref, separators=(',', ':'))+'\n', encoding='utf-8')
print(f'Recorded {len(pages)} native pages and {sum(len(p["samples"]) for p in pages)} samples.')
