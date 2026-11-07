"""Extract the native reference's actual PDF line endpoints and pen widths for zero-axis groups."""
from pathlib import Path
from hashlib import sha256
import json
import sys
from pypdf import PdfReader
from pypdf.generic import ContentStream

root = Path(__file__).resolve().parents[1]
fixture = sys.argv[1] if len(sys.argv) > 1 else 'zero-axis-groups'
assert fixture in ['zero-axis-groups', 'zero-axis-group-rotations', 'zero-axis-group-geometry', 'zero-axis-group-relative', 'straight-connector-groups']
folder = root / 'tests/fixtures' / fixture
source = root / 'public/fixtures' / (fixture + '.docx')
pdf = folder / 'native.pdf'
reader = PdfReader(pdf)
assert len(reader.pages) == 1
page = reader.pages[0]
height = float(page.mediabox.height)
cases = json.loads((folder / 'cases.json').read_text(encoding='utf-8'))
colors = [tuple(int(c['color'][i:i+2], 16) for i in (0,2,4)) for c in cases]
state = {'color': (0,0,0), 'width': 1}
stack, path = [], []
for args, op in ContentStream(page.get_contents(), reader).operations:
    if op == b'q': stack.append(state.copy())
    elif op == b'Q': state = stack.pop()
    elif op == b'cm': raise ValueError('Unexpected transformed PDF stream: extend the recorder before using it')
    elif op == b'RG': state['color'] = tuple(float(v)*255 for v in args)
    elif op == b'G': state['color'] = (float(args[0])*255,)*3
    elif op == b'w': state['width'] = float(args[0])
    elif op == b'm': path = [[float(args[0]), height-float(args[1])]]
    elif op == b'l': path.append([float(args[0]), height-float(args[1])])
    elif op == b'S':
        matches = [i for i, rgb in enumerate(colors) if max(abs(a-b) for a,b in zip(rgb,state['color'])) < 1]
        if matches:
            assert len(matches) == 1 and len(path) == 2
            case = cases[matches[0]]
            assert 'native' not in case
            case['native'] = {'start': path[0], 'end': path[1], 'strokeWidth': state['width']}
        path = []
assert all('native' in c for c in cases)
record = {'referenceVersion': '16.0.20326', 'sourceSha256': sha256(source.read_bytes()).hexdigest(),
          'pdfSha256': sha256(pdf.read_bytes()).hexdigest(), 'cases': cases}
(folder / 'reference.json').write_text(json.dumps(record, indent=2)+'\n', encoding='utf-8')
print(f'Recorded {len(cases)} native line segments and physical pen widths.')
