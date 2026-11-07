"""Record the independent native fresh-page reference and its provenance."""
import hashlib
import json
from pathlib import Path
import pypdfium2 as pdf

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/bottom-line-fresh'
pages = []
with pdf.PdfDocument(folder / 'reference.pdf') as document:
    for page in document:
        text = page.get_textpage()
        try:
            pages.append(text.get_text_range().strip())
        finally:
            text.close()
            page.close()
assert pages == list('ABCDE'), pages
paths = [root / 'public/fixtures/bottom-line-fresh.docx', folder / 'reference.pdf']
(folder / 'reference.json').write_text(json.dumps({
    'referenceBuild': '16.0.20326',
    'pages': pages,
    'hashes': {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths},
}, indent=2) + '\n', encoding='utf-8')
