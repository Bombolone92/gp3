"""Bind the authored grid-phase control to independent native PDF rectangles.

Requires pypdf (BSD-3-Clause). This tool does not import the document renderer.
"""
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream
from native_rectangle_pdf import reconstruct_rectangle_pdf
import hashlib, json, sys

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/print-frame-grid'
pdf = Path(sys.argv[1])
owned = Path(sys.argv[2])
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
source_hash = 'c0e4110d6d0f6242fe828ed5da16569e687d35f50546e5c6e1bb821b1f1033ff'
assert sha(folder/'control.docx') == source_hash
assert sha(owned) == source_hash
cases = json.loads((folder/'cases.json').read_text())
reader = PdfReader(pdf)
assert len(reader.pages) == 1 and list(reader.pages[0].mediabox) == [0,0,612,792]
assert 'Microsoft' in str(reader.metadata.producer)
rects = []; path = []; rgb = None; stack = []
for args, op in ContentStream(reader.pages[0].get_contents(), reader).operations:
    if op == b'cm': raise AssertionError('Unexpected PDF transform; capture must account for it explicitly')
    if op == b'q': stack.append(rgb)
    elif op == b'Q': rgb = stack.pop()
    elif op == b'rg': rgb = [float(v) for v in args]
    elif op == b're': path.append([float(v) for v in args])
    elif op in (b'f',b'f*'):
        if rgb == [.427,.498,.569]: rects.extend(path)
        path = []
    elif op in (b'n',b'S',b's',b'B',b'B*',b'b',b'b*'): path = []
assert len(cases) == 8 and len(rects) == 96
frames = []
for case in cases:
    group = rects[case['index']*12:(case['index']+1)*12]
    h = [r for r in group if r[2]>100 and 0<r[3]<4]
    v = [r for r in group if r[3]>5 and 0<r[2]<4]
    assert len(h) == 2 and len(v) == 2
    frames.append(dict(**case,boundsPt=[min(r[0] for r in group),
        792-max(r[1]+r[3] for r in group),max(r[0]+r[2] for r in group),
        792-min(r[1] for r in group)],horizontalWidthsPt=[r[3] for r in h],verticalWidthsPt=[r[2] for r in v]))
geometry_hash=reconstruct_rectangle_pdf(pdf,folder/'native.pdf',[len(cases)*12])
reference = dict(sourceSha256=source_hash,casesSha256=sha(folder/'cases.json'),pdfSha256=geometry_hash,nativeSourcePdfSha256=sha(pdf),
    sourceUnchanged=True,pageSizePt=[612,792],
    method='Visible reference PDF/XPS export of exact owned copy; rectangle fills/clips reconstructed without fonts/text; original PDF hash retained; no renderer input',frames=frames)
(folder/'native-print-frames.json').write_bytes((json.dumps(reference,indent=2)+'\n').encode('utf-8'))
print('Recorded eight native grid-phase frames with unchanged source bytes.')
