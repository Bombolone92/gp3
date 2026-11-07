"""Measure original reference PDF advances and object bounds, not renderer output."""
from pathlib import Path
import hashlib
import json
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[1]
folder = ROOT / 'tests/fixtures/inline-object-advance'
source = ROOT / 'public/fixtures/inline-object-advance.docx'
pdf = folder / 'native.pdf'
cases = json.loads((folder / 'cases.json').read_text())
document = pdfium.PdfDocument(pdf)
assert len(document) == len(cases)
for case, page in zip(cases, document):
    text = page.get_textpage(); full = text.get_text_range()
    before = full.index(case['id'] + ' BEFORE'); after = full.index(case['id'] + ' AFTER')
    case['advance'] = text.get_charbox(before)[3] - text.get_charbox(after)[3]
    paths = [o for o in page.get_objects() if o.type == pdfium.raw.FPDF_PAGEOBJ_PATH]
    assert len(paths) == 1
    l, b, r, t = paths[0].get_bounds()
    case['object'] = dict(left=l, top=page.get_height()-t, right=r, bottom=page.get_height()-b)
result = dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(), pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(), cases=cases)
(folder / 'reference.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
