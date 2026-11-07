"""Record native logical PDF page dimensions and asymmetric text edges."""
from pathlib import Path
import hashlib
import json
import pypdfium2 as pdf

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/book-fold'
records = []
for case in json.loads((folder/'cases.json').read_text(encoding='utf-8')):
    name = case['name']
    path = folder/f'{name}-native.pdf'
    pages = []
    with pdf.PdfDocument(path) as document:
        for page in document:
            text = page.get_textpage()
            boxes = [text.get_charbox(i) for i in range(text.count_chars()) if text.get_text_range(i,1).strip()]
            pages.append(dict(size=list(page.get_size()), left=min(b[0] for b in boxes), right=max(b[2] for b in boxes), top=page.get_height()-max(b[3] for b in boxes)))
            text.close(); page.close()
    assert len(pages) == 4, (name, len(pages))
    records.append(dict(name=name, sourceSha256=hashlib.sha256((folder/f'{name}.docx').read_bytes()).hexdigest(), pdfSha256=hashlib.sha256(path.read_bytes()).hexdigest(),pages=pages))
(folder/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',cases=records),indent=2)+'\n',encoding='utf-8')
for case in records:
    print(case['name'],case['pages'])
