"""Record independent reference PDF paths; does not import engine geometry."""
from pathlib import Path
import ctypes
import hashlib
import json
import argparse
import pypdfium2 as pdf

repo = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--medium-reverse', action='store_true')
parser.add_argument('--mixed', action='store_true')
args = parser.parse_args()
folder = repo / ('tests/fixtures/mixed-compound-borders' if args.mixed else 'tests/fixtures/thin-thick-medium' if args.medium_reverse else 'tests/fixtures/compound-border-variants')
cases = json.loads((folder / 'cases.json').read_text())
doc = pdf.PdfDocument(folder / 'native.pdf')
assert len(doc) == len(cases)
for case, page in zip(cases, doc):
    boxes = []
    for obj in page.get_objects():
        if obj.type != pdf.raw.FPDF_PAGEOBJ_PATH:
            continue
        color = [ctypes.c_uint() for _ in range(4)]
        assert pdf.raw.FPDFPageObj_GetFillColor(obj.raw, *[ctypes.byref(c) for c in color])
        x0, y0, x1, y1 = obj.get_bounds()
        if args.mixed:
            # Bounds are a valid reference only when each filled path really
            # is a rectangle; do not silently replace arbitrary polygons.
            assert pdf.raw.FPDFPath_CountSegments(obj.raw) == 5
            points = []
            for index in range(5):
                segment = pdf.raw.FPDFPath_GetPathSegment(obj.raw, index)
                x, y = ctypes.c_float(), ctypes.c_float()
                assert pdf.raw.FPDFPathSegment_GetPoint(segment, ctypes.byref(x), ctypes.byref(y))
                assert min(abs(x.value-x0), abs(x.value-x1)) < .001
                assert min(abs(y.value-y0), abs(y.value-y1)) < .001
                points.append((round(x.value, 3), round(y.value, 3)))
            assert len(set(points)) == 4
        boxes.append(dict(bounds=[round(v, 5) for v in
            [x0, page.get_height() - y1, x1 - x0, y1 - y0]],
            color=[c.value for c in color]))
    assert len(boxes) >= 16, case
    case['paths'] = boxes
    # Horizontal bands away from corners distinguish stroke widths and gaps.
    bands = sorted([b['bounds'] for b in boxes if b['bounds'][2] > 150 and
        b['bounds'][3] < 20], key=lambda b: b[1])
    assert len(bands) == 8, (case['page'], bands)
    case['horizontalBands'] = [dict(context=context, side=side,
        first=round(a[3], 5), gap=round(b[1] - a[1] - a[3], 5),
        last=round(b[3], 5)) for context, side, a, b in
        [('paragraph', 'top', *bands[0:2]), ('paragraph', 'bottom', *bands[2:4]),
         ('table', 'top', *bands[4:6]), ('table', 'bottom', *bands[6:8])]]
    page.close()
doc.close()
result = dict(referenceVersion='16.0.20326',
    sourceSha256=hashlib.sha256((folder / 'control.docx').read_bytes()).hexdigest(),
    pdfSha256=hashlib.sha256((folder / 'native.pdf').read_bytes()).hexdigest(), cases=cases)
(folder / 'reference.json').write_text(json.dumps(result, indent=2) + '\n')
for case in cases:
    if not case['frame']:
        print(case['style'], case['size'], case['horizontalBands'][0])
