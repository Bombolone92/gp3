"""Compare native reference exports of the original artwork with/without BLIP IDs."""
from pathlib import Path
import hashlib
import json
import pypdfium2 as pdf
from PIL import ImageChops

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/blip-creation-ids'
hash_file = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
records = []
with pdf.PdfDocument(folder / 'baseline-native.pdf') as baseline, pdf.PdfDocument(folder / 'native.pdf') as modified:
    assert len(baseline) == len(modified)
    for index in range(len(baseline)):
        images = [document[index].render(scale=2).to_pil().convert('RGB') for document in [baseline, modified]]
        assert images[0].size == images[1].size
        assert ImageChops.difference(*images).getbbox() is None
        records.append(dict(page=index + 1, size=images[0].size, rgbSha256=hashlib.sha256(images[0].tobytes()).hexdigest(), identical=True))
record = dict(referenceVersion='16.0.20326', sourceSha256=hash_file(folder / 'control.docx'),
              baselineSha256=hash_file(root / 'public/fixtures/drawing-creation-ids.docx'),
              pdfSha256=hash_file(folder / 'native.pdf'), baselinePdfSha256=hash_file(folder / 'baseline-native.pdf'), pages=records)
(folder / 'reference.json').write_text(json.dumps(record, indent=2) + '\n')
print('Identical native pages:', len(records))
