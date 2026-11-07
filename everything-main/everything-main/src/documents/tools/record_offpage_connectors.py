"""Record independent native reference pixels and bind them to source/PDF bytes."""
from pathlib import Path
import hashlib, json
import pypdfium2 as pdfium
from PIL import Image
root = Path(__file__).resolve().parents[1] / 'tests/fixtures/offpage-connectors'
pdf = pdfium.PdfDocument(str(root / 'native.pdf'))
assert len(pdf) == 1
im = pdf[0].render(scale=4).to_pil().convert('RGB')
im.resize((816,1056),Image.Resampling.BOX).save(root / 'native.png')
meta = {'referenceVersion':'16.0.20326','pages':len(pdf)}
for key, name in [('sourceSha256','control.docx'),('pdfSha256','native.pdf'),('pngSha256','native.png')]:
    meta[key] = hashlib.sha256((root/name).read_bytes()).hexdigest()
(root/'reference.json').write_text(json.dumps(meta,indent=2)+'\n',encoding='utf-8')
