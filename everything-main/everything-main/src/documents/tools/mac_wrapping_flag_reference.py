"""Pin reference captures and prove the isolated flag has no raster effect."""
from pathlib import Path
import hashlib
import json
import pypdfium2 as pdf

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/mac-wrapping-flag'
sha = lambda data: hashlib.sha256(data).hexdigest()
records = {}
for source in sorted(root.glob('*.docx')):
    native = source.with_name(source.stem + '-native.pdf')
    document = pdf.PdfDocument(native)
    rasters = [sha(page.render(scale=2).to_pil().convert('RGB').tobytes()) for page in document]
    records[source.stem] = dict(sourceSha256=sha(source.read_bytes()), pdfSha256=sha(native.read_bytes()), rasterSha256=rasters)
for name, record in records.items():
    assert record['rasterSha256'] == records['absent']['rasterSha256'], name
(root / 'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326', scale=2, variants=records), indent=2) + '\n')
print(f"PASS {len(records)} variants: all native pages RGB-identical to the absent flag")
