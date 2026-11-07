"""Measure native decoration spans independently from the application."""
from pathlib import Path
from hashlib import sha256
import ctypes as c
import json
import pypdfium2 as p

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/bidi-decorations'
cases = json.loads((root/'cases.json').read_text(encoding='utf-8'))
results = []
for index, page in enumerate(p.PdfDocument(root/'native.pdf')):
    paths = []
    for obj in page.get_objects():
        if obj.type != p.raw.FPDF_PAGEOBJ_PATH: continue
        rgba = [c.c_uint() for _ in range(4)]
        mode, stroke = c.c_int(), c.c_int()
        assert p.raw.FPDFPageObj_GetFillColor(obj, *[c.byref(v) for v in rgba])
        assert p.raw.FPDFPath_GetDrawMode(obj, c.byref(mode), c.byref(stroke))
        if not mode.value: continue
        x, bottom, right, top = obj.get_bounds()
        paths.append(dict(x=x, y=page.get_height()-top, width=right-x, height=top-bottom, color=[v.value for v in rgba]))
    paths.sort(key=lambda v: v['y'])
    decorated = [case for case in cases[index*6:index*6+6] if case['mode'] != 'color']
    assert len(paths) == len(decorated), (index, paths)
    results.extend(dict(index=case['index'], page=index, **path) for case, path in zip(decorated, paths))
data = dict(referenceVersion='16.0.20326', cases=results)
for file, key in [('control.docx', 'sourceSha256'), ('native.pdf', 'pdfSha256'), ('cases.json', 'casesSha256')]:
    data[key] = sha256((root/file).read_bytes()).hexdigest()
(root/'reference.json').write_text(json.dumps(data, indent=2)+'\n', encoding='utf-8')
