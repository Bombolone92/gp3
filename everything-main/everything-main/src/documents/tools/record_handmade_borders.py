"""Bind native reference evidence to the independently authored art-border control."""
from pathlib import Path
import hashlib
import json
from ctypes import c_uint, c_float, byref
import pypdfium2 as pdf
import pypdfium2.raw as raw

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/handmade-borders'
document = pdf.PdfDocument(str(root / 'native.pdf'))
assert len(document) == 4
pages = []
for index, page in enumerate(document):
    kinds = {}
    colored_bounds = []
    for obj in page.get_objects():
        key = str(obj.type)
        kinds[key] = kinds.get(key, 0) + 1
        rgba = [c_uint() for _ in range(4)]
        if raw.FPDFPageObj_GetFillColor(obj.raw, *[byref(v) for v in rgba]) and [v.value for v in rgba] == [0, 112, 192, 255]:
            bounds = [c_float() for _ in range(4)]
            if not raw.FPDFPageObj_GetBounds(obj.raw, *[byref(v) for v in bounds]):
                raise RuntimeError('Cannot measure native border object')
            colored_bounds.append([round(v.value, 5) for v in bounds])
    # Native PDF coordinates: left, bottom, right, top, in points.
    # These are path bounds, not filled-pixel extents or an artwork definition.
    assert len(colored_bounds) == (12 if index == 0 else 8)
    pages.append(dict(page=index, objectTypes=kinds, bluePathBounds=colored_bounds))
reference = dict(referenceBuild='16.0.20326',
    sourceSha256=hashlib.sha256((root / 'control.docx').read_bytes()).hexdigest(),
    pdfSha256=hashlib.sha256((root / 'native.pdf').read_bytes()).hexdigest(), pages=pages)
(root / 'reference.json').write_text(json.dumps(reference, indent=2) + '\n')
