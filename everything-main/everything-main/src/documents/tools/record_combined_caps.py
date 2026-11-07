"""Record actual reference glyph case and font sizes for combined flags."""
from pathlib import Path
import hashlib, json, re
import pypdfium2 as pdfium
root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/combined-caps'
source = root / 'public/fixtures/combined-caps.docx'
pdf = folder / 'native.pdf'
cases = json.loads((folder / 'cases.json').read_text())
rows = {}
doc = pdfium.PdfDocument(pdf)
for page in doc:
    text = page.get_textpage()
    chars = [(text.get_text_range(i, 1), round(pdfium.raw.FPDFText_GetFontSize(text.raw, i), 5)) for i in range(text.count_chars())]
    labels = list(re.finditer(r'K\d{2}\s', ''.join(c for c, size in chars)))
    for i, label in enumerate(labels):
        glyphs = [(c, size) for c, size in chars[label.end():labels[i+1].start() if i+1 < len(labels) else len(chars)] if not c.isspace()]
        assert ''.join(c for c, size in glyphs) in ['AbcXYZ', 'ABCXYZ']
        rows[label.group().strip()] = glyphs
assert len(rows) == len(cases) == 48
for case in cases:
    case['glyphs'] = rows[case['id']]
    print(case['id'], case['context'], case['inherited'], int(case['caps']), int(case['smallCaps']), case['glyphs'][:3])
(folder / 'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326', sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(), pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(), pages=len(doc), cases=cases), indent=2) + '\n')
