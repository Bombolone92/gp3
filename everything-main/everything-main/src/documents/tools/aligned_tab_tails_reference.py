"""Record independent reference text origins; never derive expectations from the app."""
from pathlib import Path
from hashlib import sha256
import json
from pypdf import PdfReader

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/aligned-tab-tails'
cases = json.loads((folder / 'cases.json').read_text())
origins = []
for page in PdfReader(folder / 'native.pdf').pages:
    def visit(text, cm, tm, font, size):
        if text.startswith('AB12'):
            origins.append({'x': tm[4], 'y': float(page.mediabox.height) - tm[5]})
    page.extract_text(visitor_text=visit)
assert len(origins) == len(cases) == 14
result = {'reference': 'Native reference application',
          'hashes': {name: sha256((folder / name).read_bytes()).hexdigest()
                     for name in ['source.docx', 'native.pdf']},
          'cases': [dict(case, **origin) for case, origin in zip(cases, origins)]}
(folder / 'reference.json').write_text(json.dumps(result, indent=2) + '\n')
