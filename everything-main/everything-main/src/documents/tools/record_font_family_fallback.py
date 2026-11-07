"""Record original reference PDF font choices and positions after native export."""
from pathlib import Path
from hashlib import sha256
import json
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/font-family-fallback'
records = {}
for name in ['font-family-fallback', 'font-family-fallback-base', 'font-family-fallback-theme']:
    source = root / 'public/fixtures' / (name + '.docx')
    pdf = folder / (name + '-native.pdf')
    document = PdfReader(pdf)
    rows = []
    for page in document.pages:
        def capture(text, cm, tm, font, size):
            if text.strip():
                assert cm == [1, 0, 0, 1, 0, 0] and tm[:4] == [1, 0, 0, 1]
                rows.append({'text': text.strip(), 'font': font['/BaseFont'].split('+')[-1],
                             'size': size, 'x': tm[4], 'y': float(page.mediabox.height) - tm[5]})
        page.extract_text(visitor_text=capture)
    records[name] = {'sourceSha256': sha256(source.read_bytes()).hexdigest(),
                     'pdfSha256': sha256(pdf.read_bytes()).hexdigest(),
                     'referenceBuild': '16.0.20326', 'pages': len(document.pages), 'rows': rows}
(folder / 'reference.json').write_text(json.dumps(records, indent=2) + '\n')
