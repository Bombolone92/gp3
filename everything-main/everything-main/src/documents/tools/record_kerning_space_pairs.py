"""Bind the original space-pair control to its native reference PDF."""
from pathlib import Path
from hashlib import sha256
import json
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/kerning-space-pairs'
source = root / 'public/fixtures/kerning-space-pairs.docx'
pdf = folder / 'native.pdf'
reader = PdfReader(pdf)
assert len(reader.pages) == 1
groups, pdf_text = {}, []
def visit(text, cm, tm, font, size):
    if text.strip():
        groups.setdefault(tm[5], []).append(dict(text=text.strip(), x=tm[4]))
        pdf_text.append(dict(text=text.strip(), x=tm[4], y=tm[5], sizePt=size))
reader.pages[0].extract_text(visitor_text=visit)
lines = [dict(y=y, x=min(s['x'] for s in spans), text=''.join(s['text'] for s in spans))
         for y, spans in sorted(groups.items(), reverse=True)]
expected = ['The World’s Best Dad'] * 3 + ['AVATAR Toffee', 'The World’s Best Dad']
assert len(lines) == len(expected)
for line, text in zip(lines, expected):
    assert line['text'].replace(' ', '') == text.replace(' ', '')
result = dict(referenceVersion='16.0.20326', sourceSha256=sha256(source.read_bytes()).hexdigest(),
              status='unresolved native space-pair kerning', pdfText=pdf_text,
              pdfSha256=sha256(pdf.read_bytes()).hexdigest(), lines=lines)
(folder / 'reference.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf8')
