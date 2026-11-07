"""Record native reference side-border samples independently of engine geometry."""
from pathlib import Path
from hashlib import sha256
import json
import pypdfium2 as pdfium

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/merged-side-borders'
document = pdfium.PdfDocument(folder / 'native.pdf')
cases = []
for index, name in enumerate(json.loads((folder / 'cases.json').read_text())):
    page = document[index]
    bitmap = page.render(scale=4)
    image = bitmap.to_pil().convert('RGB')
    samples = []
    for y in [102, 138, 174]:
        x = 210.65
        rgb = image.getpixel((round(x*4), y*4))
        samples.append(dict(x=x, y=y, rgb=list(rgb), ink=max(rgb)-min(rgb) > 40))
    cases.append(dict(name=name, samples=samples))
    bitmap.close()
    page.close()
document.close()
result = dict(referenceVersion='16.0.20326', cases=cases,
    sourceSha256=sha256((folder/'controls.docx').read_bytes()).hexdigest(),
    pdfSha256=sha256((folder/'native.pdf').read_bytes()).hexdigest())
(folder/'reference.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
