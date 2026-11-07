"""Record independently exported reference positions and their source/PDF provenance."""
import argparse
import hashlib
import json
from pathlib import Path
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument('group', choices=['flow', 'start', 'border', 'rows'])
group = parser.parse_args().group
folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/multipage-floating'
result = {'lines': {}, 'hashes': {}}
for pdf in sorted(folder.glob(f'{group}-*.pdf')):
    rows = []
    for index, page in enumerate(PdfReader(pdf).pages):
        def visitor(text, cm, tm, font, size):
            if text.strip():
                rows.append({'page': index, 'text': text.strip(), 'x': round(tm[4], 3),
                             'y': round(float(page.mediabox.height) - tm[5], 3)})
        page.extract_text(visitor_text=visitor)
    result['lines'][pdf.stem] = rows
    for file in [pdf, pdf.with_suffix('.docx')]:
        result['hashes'][file.name] = hashlib.sha256(file.read_bytes()).hexdigest()
if not result['lines']:
    raise SystemExit('No native PDFs found')
(folder / f'{group}-reference.json').write_text(json.dumps(result, indent=2) + '\n')
