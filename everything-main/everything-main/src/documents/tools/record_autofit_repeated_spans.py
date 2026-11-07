"""Read native PDF cell fills without using application layout output."""
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream
import hashlib
import json

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/autofit-repeated-spans'
pdf = PdfReader(folder / 'native.pdf')
cases = []
colors = [(1., .667, .667), (.667, 1., .667), (.667, .667, 1.)]
for page in pdf.pages:
    color = None
    stack = []
    path = []
    cells = {}
    for args, op in ContentStream(page.get_contents(), pdf).operations:
        if op == b'q':
            stack.append(color)
        elif op == b'Q':
            color = stack.pop()
        elif op == b'rg':
            color = tuple(float(x) for x in args)
        elif op in [b'g', b'k']:
            color = None
        elif op == b're':
            path.append(tuple(float(x) for x in args))
        elif op in [b'f', b'f*']:
            if color in colors:
                for x, y, width, height in path:
                    old = cells.get(color)
                    if old is None or width * height > old['width'] * old['height']:
                        cells[color] = dict(x=x, top=float(page.mediabox.height)-y-height, width=width, height=height)
            path = []
        elif op in [b'n', b'S', b's']:
            path = []
    assert len(cells) == 3
    cases.append([cells[c] for c in colors])
record = dict(referenceBuild='16.0.20326', cases=cases, hashes={name:hashlib.sha256((folder/name).read_bytes()).hexdigest() for name in ['control.docx','native.pdf']})
(folder/'reference.json').write_text(json.dumps(record, indent=2)+'\n', encoding='utf-8')
