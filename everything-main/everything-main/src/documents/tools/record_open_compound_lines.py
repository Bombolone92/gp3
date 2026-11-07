"""Extract the reference's filled vector contours, without using renderer geometry."""
from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
from shutil import copyfile
from pypdf import PdfReader
from pypdf.generic import ContentStream
import json
import sys

root = Path(__file__).resolve().parents[1]
out = root / 'tests/fixtures/open-compound-lines'
work = Path(sys.argv[1])
source = out / 'control.docx'
with ZipFile(source) as original, ZipFile(work / 'open-compound-lines.docx') as opened:
    assert set(original.namelist()) == set(opened.namelist())
    assert all(original.read(n) == opened.read(n) for n in original.namelist())
pdf = work / 'open-compound-lines.pdf'
reader = PdfReader(pdf)
assert len(reader.pages) == 4
cases = json.loads((out / 'cases.json').read_text())
shapes = []
for page_index, page in enumerate(reader.pages):
    height = float(page.mediabox.height)
    assert list(map(float, page.mediabox)) == [0, 0, 288, 216]
    current = None
    for args, op in ContentStream(page.get_contents(), reader).operations:
        assert op != b'cm', 'Unexpected coordinate transform'
        if op == b'BDC' and str(args[0]) == '/P':
            assert current is None
            current = dict(page=page_index, mcid=int(args[1]['/MCID']), paths=[], fills=0)
        elif current is not None and op in [b'm', b'l', b'c', b'h']:
            values = list(map(float, args))
            # Convert PDF bottom-up physical points to page top-down points.
            for i in range(1, len(values), 2):
                values[i] = round(height - values[i], 6)
            current['paths'].append([op.decode(), *values])
        elif current is not None and op == b'f':
            current['fills'] += 1
        elif current is not None and op == b'EMC':
            assert current['fills'] == 1 and current['paths']
            shapes.append(current)
            current = None
    assert current is None
    assert len([s for s in shapes if s['page'] == page_index]) == 12

for case, shape in zip(cases, shapes, strict=True):
    assert shape['page'] == case['page'] and shape['mcid'] == (case['id'] - 1) % 12 + 1
    shape['id'] = case['id']
    if not case['curve']:
        # Straight bands are rectangular subpaths; native round caps are separate
        # cubic subpaths. Record measured bands, not renderer-derived expectations.
        subpaths, active = [], []
        for command in shape['paths']:
            active.append(command)
            if command[0] == 'h':
                subpaths.append(active)
                active = []
        assert not active
        rectangles = [p for p in subpaths if [c[0] for c in p] == ['m', 'l', 'l', 'l', 'h']]
        shape['bands'] = sorted([
            dict(leftPt=min(c[1] for c in p[:-1]), rightPt=max(c[1] for c in p[:-1]),
                 topPt=min(c[2] for c in p[:-1]), bottomPt=max(c[2] for c in p[:-1]))
            for p in rectangles], key=lambda b: b['topPt'])
        assert len(shape['bands']) == (3 if case['compound'] == 'tri' else 2)
        shape['roundCapCount'] = sum(any(c[0] == 'c' for c in p) for p in subpaths)
        assert shape['roundCapCount'] == (2 if case['cap'] == 'rnd' else 0)

copyfile(pdf, out / 'native.pdf')
result = dict(sourceSha256=sha256(source.read_bytes()).hexdigest(),
              pdfSha256=sha256(pdf.read_bytes()).hexdigest(),
              casesSha256=sha256((out / 'cases.json').read_bytes()).hexdigest(),
              units='physical points, top-left page origin', shapes=shapes)
(out / 'reference.json').write_text(json.dumps(result, indent=2) + '\n')
print('Recorded 48 native compound outlines, including 24 measured straight-band controls.')
