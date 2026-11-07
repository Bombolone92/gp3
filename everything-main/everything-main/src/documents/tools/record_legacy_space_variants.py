"""Record native reference origins for the original legacy-space variant control."""
from pathlib import Path
from hashlib import sha256
from pypdf import PdfReader
import json

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/legacy-space-variants'
cases = json.loads((folder / 'cases.json').read_text())
source, pdf = folder / 'control.docx', folder / 'native.pdf'
reader = PdfReader(pdf)
assert len(reader.pages) == 2
lines = []
for index, page in enumerate(reader.pages):
    groups = {}
    def visit(text, cm, tm, font, size):
        if text.strip():
            groups.setdefault(tm[5], []).append(dict(x=tm[4], text=text.strip()))
    page.extract_text(visitor_text=visit)
    for y, spans in sorted(groups.items(), reverse=True):
        lines.append(dict(page=index, x=min(s['x'] for s in spans), y=y, text=''.join(s['text'] for s in spans)))
assert len(lines) == len(cases)
for line, case in zip(lines, cases):
    assert ''.join(line['text'].split()) == ''.join(case['text'].split())
result = dict(referenceVersion='16.0.20326', sourceSha256=sha256(source.read_bytes()).hexdigest(),
              pdfSha256=sha256(pdf.read_bytes()).hexdigest(), lines=lines)
(folder / 'reference.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf8')
