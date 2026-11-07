"""Record independent native reference pixels and bind them to source/PDF bytes."""
from pathlib import Path
import hashlib, json
import pypdfium2 as pdfium
from PIL import Image
root = Path(__file__).resolve().parents[1] / 'tests/fixtures/ribbons'
pdf = pdfium.PdfDocument(str(root / 'fills-native.pdf'))
assert len(pdf) == 1
# Dense native pattern tiles must be sampled at the compared device resolution.
# Supersampling then BOX-downscaling produces a different periodic phase/moire.
im = pdf[0].render(scale=4/3).to_pil().convert('RGB')
assert im.size == (816,1056)
im.save(root / 'fills-native.png')
meta = {'referenceVersion':'16.0.20326','pages':len(pdf),'raster':'PDFium direct 96dpi (native pattern tile sampling)'}
for key, name in [('sourceSha256','fills.docx'),('pdfSha256','fills-native.pdf'),('pngSha256','fills-native.png')]:
    meta[key] = hashlib.sha256((root/name).read_bytes()).hexdigest()
(root/'fills-reference.json').write_text(json.dumps(meta,indent=2)+'\n',encoding='utf-8')
