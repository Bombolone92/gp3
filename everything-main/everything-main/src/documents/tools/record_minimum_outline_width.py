"""Read native PDF pen operators and bind them to original control sources."""
from pathlib import Path
from hashlib import sha256
from pypdf import PdfReader
from pypdf.generic import ContentStream
import json
root = Path(__file__).resolve().parents[1] / 'tests/fixtures/minimum-outline-width'
result = {'referenceVersion': '16.0.20326', 'controls': {}}
for kind in ['shape', 'picture']:
    reader = PdfReader(root / f'{kind}-native.pdf')
    pages = []
    first_rectangle = None
    for page in reader.pages:
        width, stack, pens = 1, [], []
        rectangle = None
        for args, op in ContentStream(page.get_contents(), reader).operations:
            if op == b'q': stack.append(width)
            elif op == b'Q': width = stack.pop()
            elif op == b'w': width = float(args[0])
            elif op == b're': rectangle = [float(v) for v in args]
            elif op in (b'n', b'f', b'f*', b'm'): rectangle = None
            elif op in (b'S', b's'):
                if first_rectangle is None and rectangle is not None:
                    x, y, w, h = rectangle
                    first_rectangle = [x, float(page.mediabox.height)-y-h, w, h]
                pens.append(width)
                rectangle = None
        pages.append(pens)
    result['controls'][kind] = {'sourceSha256': sha256((root / f'{kind}.docx').read_bytes()).hexdigest(),
        'pdfSha256': sha256((root / f'{kind}-native.pdf').read_bytes()).hexdigest(), 'pages': pages, 'firstStrokeRectanglePt': first_rectangle}
(root / 'reference.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
