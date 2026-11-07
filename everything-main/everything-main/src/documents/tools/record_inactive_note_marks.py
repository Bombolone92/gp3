"""Bind original controls to native reference PDF observations; no rendering engine."""
from pathlib import Path
from hashlib import sha256
import json
import pypdfium2 as pdf

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/inactive-note-marks'
records = []
for name in ['control', 'numbering-upperRoman', 'numbering-decimalZero', 'literal']:
    source = root / (name+'.docx')
    reference = root / ('native.pdf' if name == 'control' else name+'-native.pdf')
    document = pdf.PdfDocument(reference)
    records.append(dict(name=name, sourceSha256=sha256(source.read_bytes()).hexdigest(),
        pdfSha256=sha256(reference.read_bytes()).hexdigest(), pages=len(document),
        text='\n'.join(page.get_textpage().get_text_range() for page in document)))
(root/'reference.json').write_text(json.dumps(dict(referenceBuild='16.0.20326', cases=records), indent=2), encoding='utf-8')
