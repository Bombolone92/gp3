"""Record paired body/text-box coordinates directly from the reference PDF."""
from pathlib import Path
from hashlib import sha256
from pypdf import PdfReader
import json, re
folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/nested-shape-tables'
result = dict(reference='native reference application', cases=json.loads((folder/'cases.json').read_text()), lines=[], hashes={})
for name in ['control.docx', 'native.pdf']:
    result['hashes'][name] = sha256((folder/name).read_bytes()).hexdigest()
pages = PdfReader(folder/'native.pdf').pages
assert len(pages) == len(result['cases']) == 16
for i, page in enumerate(pages):
    def visit(text, cm, tm, font, size):
        text = re.sub(r'\s+', ' ', text).strip()
        if text in ['B outer', 'S outer', 'B A', 'S A', 'B B', 'S B']:
            result['lines'].append(dict(page=i, text=text, x=tm[4], y=float(page.mediabox.height)-tm[5]))
    page.extract_text(visitor_text=visit)
assert len(result['lines']) == 96
(folder/'reference.json').write_text(json.dumps(result, indent=2)+'\n')
print(len(result['lines']), 'native origins')
