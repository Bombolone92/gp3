"""Record independent native PDF frame geometry for the six-width control.

Requires pypdf (BSD-3-Clause). Does not invoke the document renderer.
"""
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream
from native_rectangle_pdf import reconstruct_rectangle_pdf
import hashlib
import json
import sys

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/border-device-pixels'
manifest = json.loads((folder / 'manifest.json').read_text())
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
for name in ['control-15.docx', 'native-15.pdf']:
    assert sha(folder / name) == manifest[name], name
reader = PdfReader(folder / 'native-15.pdf')
assert len(reader.pages) == 1
page = reader.pages[0]
assert list(page.mediabox) == [0, 0, 612, 792]
rgb = None
stack = []
path = []
rects = []
for args, op in ContentStream(page.get_contents(), reader).operations:
    if op == b'q':
        stack.append(rgb)
    elif op == b'Q':
        rgb = stack.pop()
    elif op == b'rg':
        rgb = [float(v) for v in args]
    elif op == b're':
        path.append([float(v) for v in args])
    elif op in (b'f', b'f*'):
        if rgb == [.427, .498, .569]:
            rects.extend(path)
        path = []
    elif op in (b'n', b'S', b's', b'B', b'B*', b'b', b'b*'):
        path = []
# Independently observed native output contains twelve filled rectangles per
# single-cell frame (including duplicated corner artifacts). Unexpected output
# must fail capture rather than silently assigning rectangles to another table.
assert len(rects) == 72
frames = []
for index, size in enumerate([2, 4, 6, 8, 12, 16]):
    group = rects[index * 12:(index + 1) * 12]
    horizontal = [r for r in group if r[2] > 100 and 0 < r[3] < 4]
    vertical = [r for r in group if r[3] > 5 and 0 < r[2] < 4]
    assert len(horizontal) == 2 and len(vertical) == 2
    frames.append(dict(sizeEighthPoints=size, boundsPt=[
        min(r[0] for r in group),
        792 - max(r[1] + r[3] for r in group),
        max(r[0] + r[2] for r in group),
        792 - min(r[1] for r in group),
    ], horizontalWidthsPt=[r[3] for r in horizontal], verticalWidthsPt=[r[2] for r in vertical]))
reference = dict(sourceSha256=manifest['control-15.docx'],
                 pdfSha256=manifest['native-15.pdf'], pageSizePt=[612, 792],
                 method='Native PDF filled rectangles; top-left physical coordinates; no renderer input',
                 frames=frames)
(folder / 'native-print-frames.json').write_bytes(
    (json.dumps(reference, indent=2) + '\n').encode('utf-8'))
print(f'Recorded {len(frames)} native print frames from {len(rects)} rectangles.')

if len(sys.argv) > 1:
    phase_folder = folder.parent / 'print-border-phase'
    phase_pdf = Path(sys.argv[1])
    phase_source = phase_folder / 'control.docx'
    assert sha(phase_source) == '6d84960b2c7c950c66f254fa7aa851f01128ff16a4cf706ea657aeab2592ac7c'
    cases = json.loads((phase_folder / 'cases.json').read_text())
    reader = PdfReader(phase_pdf)
    assert len(reader.pages) == 1
    assert list(reader.pages[0].mediabox) == [0, 0, 612, 792]
    assert 'Microsoft' in str(reader.metadata.producer)
    rgb = None; stack = []; path = []; rects = []
    for args, op in ContentStream(reader.pages[0].get_contents(), reader).operations:
        if op == b'q': stack.append(rgb)
        elif op == b'Q': rgb = stack.pop()
        elif op == b'rg': rgb = [float(v) for v in args]
        elif op == b're': path.append([float(v) for v in args])
        elif op in (b'f', b'f*'):
            if rgb == [.427, .498, .569]: rects.extend(path)
            path = []
        elif op in (b'n', b'S', b's', b'B', b'B*', b'b', b'b*'): path = []
    assert len(cases) == 16 and len(rects) == 192
    frames = []
    for case in cases:
        group = rects[case['index'] * 12:(case['index'] + 1) * 12]
        horizontal = [r for r in group if r[2] > 100 and 0 < r[3] < 4]
        vertical = [r for r in group if r[3] > 5 and 0 < r[2] < 4]
        assert len(horizontal) == 2 and len(vertical) == 2
        frames.append(dict(**case, boundsPt=[min(r[0] for r in group),
            792 - max(r[1] + r[3] for r in group), max(r[0] + r[2] for r in group),
            792 - min(r[1] for r in group)], horizontalWidthsPt=[r[3] for r in horizontal], verticalWidthsPt=[r[2] for r in vertical]))
    geometry_hash=reconstruct_rectangle_pdf(phase_pdf,phase_folder/'native.pdf',[len(cases)*12])
    reference = dict(sourceSha256=sha(phase_source), casesSha256=sha(phase_folder / 'cases.json'),
                     pdfSha256=geometry_hash,nativeSourcePdfSha256=sha(phase_pdf), pageSizePt=[612, 792], method='Visible reference read-only PDF export; rectangle fills/clips reconstructed without fonts/text; original PDF hash retained; no renderer input', frames=frames)
    (phase_folder / 'native-print-frames.json').write_bytes((json.dumps(reference, indent=2)+'\n').encode('utf-8'))
    print('Recorded all sixteen native phase frames.')
