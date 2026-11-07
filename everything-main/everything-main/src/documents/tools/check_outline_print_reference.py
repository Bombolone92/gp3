"""Read-only verification of retained reference PDF physical pens; no font extraction."""
import json,hashlib
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream

root=Path(__file__).resolve().parents[1]/'tests/fixtures/outline-display-width'
reference=json.loads((root/'reference.json').read_text())
data=(root/'native-modern.pdf').read_bytes()
if hashlib.sha256(data).hexdigest()!=reference['nativePdfSha256']:
    raise ValueError('Native PDF hash mismatch')
reader=PdfReader(root/'native-modern.pdf');pens=[];pen=None
for page in reader.pages:
    for args,operation in ContentStream(page.get_contents(),reader).operations:
        if operation==b'cm':raise ValueError('Transformed paths require transform-aware verification')
        if operation==b'w':pen=float(args[0])
        if operation==b'S':pens.append(pen)
expected=[.14,.14,.14,.14,.25,.25,.34071,.34071,.5,.5,.75,.75,1,1,1.5,1.5]
if pens!=reference['nativePdfStrokeWidthsPt'] or pens!=expected:
    raise ValueError('Native physical pen widths mismatch')
print('Verified reference PDF hash and all sixteen physical outline widths:',pens)
