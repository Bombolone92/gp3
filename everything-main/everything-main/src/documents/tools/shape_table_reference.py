"""Record text origins from independent reference PDFs, never from engine output."""
from pathlib import Path
from hashlib import sha256
import json
from pypdf import PdfReader

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/shape-tables'
result = {'reference': 'native reference application', 'hashes': {}, 'tables': []}
for name in ['source.docx', 'native.pdf', 'symbols.docx', 'symbols-native.pdf']:
    result['hashes'][name] = sha256((folder/name).read_bytes()).hexdigest()
for index, page in enumerate(PdfReader(folder/'native.pdf').pages):
    def visit(text, cm, tm, font, size):
        if text.strip(): result['tables'].append({'page': index, 'text': text.strip(), 'x': tm[4], 'y': float(page.mediabox.height)-tm[5]})
    page.extract_text(visitor_text=visit)
assert len(result['tables']) == 42
(folder/'reference.json').write_text(json.dumps(result, indent=2)+'\n')
