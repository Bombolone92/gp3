"""Extract table border geometry from the independently exported reference PDF."""
from pathlib import Path
import ctypes as c
import hashlib
import json
import pypdfium2 as p

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/autofit-picture-preferences'
cases = json.loads((folder / 'cases.json').read_text())
doc = p.PdfDocument(folder / 'native.pdf')
assert len(doc) == len(cases)
for index, case in enumerate(cases):
    page = doc[index]
    sides = []
    for j in range(p.raw.FPDFPage_CountObjects(page)):
        obj = p.raw.FPDFPage_GetObject(page, j)
        if p.raw.FPDFPageObj_GetType(obj) != p.raw.FPDF_PAGEOBJ_PATH:
            continue
        color = [c.c_uint() for _ in range(4)]
        p.raw.FPDFPageObj_GetFillColor(obj, *[c.byref(v) for v in color])
        if [v.value for v in color] != [0, 170, 0, 255]:
            continue
        bounds = [c.c_float() for _ in range(4)]
        assert p.raw.FPDFPageObj_GetBounds(obj, *[c.byref(v) for v in bounds])
        left, bottom, right, top = [v.value for v in bounds]
        if right-left < 2 and top-bottom > 20:
            sides.append((left+right)/2)
    assert len(sides) == 2
    case.update(left=min(sides), width=max(sides)-min(sides))
    print(case)
result = dict(referenceVersion='16.0.20326', cases=cases, sha256={
    name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
    for name in ['control.docx', 'cases.json', 'native.pdf']})
(folder / 'reference.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf8')
