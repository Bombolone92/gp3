"""Record native reference cell fills for independent AutoFit width controls."""
from pathlib import Path
from pypdf import PdfReader
import hashlib
import json

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/autofit-cell-preferences'
records = []
colors = [(51, 102, 153), (204, 102, 51)]
for pdf in sorted(folder.glob('*.pdf')):
    pages = PdfReader(pdf).pages
    assert len(pages) == 8
    cases = []
    for page in pages:
        color, rectangle = None, None
        cells = {}
        for args, op in page.get_contents().operations:
            if op == b'rg': color = tuple(round(float(v) * 255) for v in args)
            elif op == b're': rectangle = [float(v) for v in args]
            elif op in [b'f', b'f*'] and color in colors and rectangle and rectangle[3] >= 23.9:
                cells.setdefault(color, dict(x=rectangle[0], width=rectangle[2], top=float(page.mediabox.height) - rectangle[1] - rectangle[3]))
        assert len(cells) == 2
        cases.append([cells[color] for color in colors])
    records.append(dict(name=pdf.stem, sourceSha256=hashlib.sha256(pdf.with_suffix('.docx').read_bytes()).hexdigest(), pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(), cases=cases))
(folder / 'reference.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')
for record in records:
    print(record['name'], [[cell['width'] for cell in row] for row in record['cases']])
