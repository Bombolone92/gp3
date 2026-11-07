"""Extract independent native exact-row geometry using pypdf (BSD-3-Clause)."""
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream
from native_rectangle_pdf import reconstruct_rectangle_pdf
import hashlib, json, sys

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/print-row-phase'
pdf, owned = map(Path, sys.argv[1:3])
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
source_hash = 'f959898a84ebac85c3c7d993732aad02cd56b614fb089dc4dcbb27324bc28fe7'
assert sha(folder/'control.docx') == source_hash and sha(owned) == source_hash
cases = json.loads((folder/'cases.json').read_text())
reader = PdfReader(pdf)
assert len(reader.pages) == len(cases) == 16
assert 'Microsoft' in str(reader.metadata.producer)
frames = []
for index, (page, case) in enumerate(zip(reader.pages, cases)):
    assert list(page.mediabox) == [0,0,612,792] and case['page'] == index
    rects = []; path = []; rgb = None; stack = []
    for args, op in ContentStream(page.get_contents(), reader).operations:
        if op == b'cm': raise AssertionError('Unexpected PDF transform; account for it explicitly')
        if op == b'q': stack.append(rgb)
        elif op == b'Q': rgb = stack.pop()
        elif op == b'rg': rgb = [float(v) for v in args]
        elif op == b're': path.append([float(v) for v in args])
        elif op in (b'f', b'f*'):
            if rgb == [.427,.498,.569]: rects.extend(path)
            path = []
        elif op in (b'n', b'S', b's', b'B', b'B*', b'b', b'b*'): path = []
    assert len(rects) == 12
    h = [r for r in rects if r[2]>100 and 0<r[3]<4]
    v = [r for r in rects if r[3]>5 and 0<r[2]<4]
    assert len(h) == len(v) == 2
    frames.append(dict(**case, boundsPt=[min(r[0] for r in rects),
        792-max(r[1]+r[3] for r in rects), max(r[0]+r[2] for r in rects),
        792-min(r[1] for r in rects)], horizontalWidthsPt=[r[3] for r in h], verticalWidthsPt=[r[2] for r in v]))
geometry_hash=reconstruct_rectangle_pdf(pdf,folder/'native.pdf',[12]*len(cases))
reference = dict(sourceSha256=source_hash, casesSha256=sha(folder/'cases.json'), pdfSha256=geometry_hash,nativeSourcePdfSha256=sha(pdf),
    sourceUnchanged=True, pageSizePt=[612,792], pageCount=16,
    method='Visible reference PDF/XPS export of exact owned source; rectangle fills/clips reconstructed without fonts/text; original PDF hash retained; no renderer input', frames=frames)
(folder/'native-print-frames.json').write_bytes((json.dumps(reference, indent=2)+'\n').encode('utf-8'))
print('Recorded sixteen isolated native row frames; source bytes unchanged.')
