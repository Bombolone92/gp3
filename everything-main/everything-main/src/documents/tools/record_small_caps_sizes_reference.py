"""Record the native reference's actual PDF font sizes, independently of the renderer's rule."""
from pathlib import Path
import hashlib, json, re
import pypdfium2 as pdfium
repo = Path(__file__).resolve().parents[1]
root = repo/'tests/fixtures/small-caps-sizes'
source = repo/'public/fixtures/small-caps-sizes.docx'
pdf = root/'native.pdf'
cases = json.loads((root/'cases.json').read_text())
rows = {}
doc = pdfium.PdfDocument(pdf)
for page in doc:
    text = page.get_textpage()
    chars = [(text.get_text_range(i,1), pdfium.raw.FPDFText_GetFontSize(text.raw,i)) for i in range(text.count_chars())]
    labels = list(re.finditer(r'K\d{3}\s', ''.join(c for c,size in chars)))
    for i,label in enumerate(labels):
        glyphs = [(c,round(size,5)) for c,size in chars[label.end():labels[i+1].start() if i+1<len(labels) else len(chars)] if not c.isspace()]
        assert ''.join(c for c,size in glyphs) == 'AABBÉΣΣЖЖ9!?'
        rows[label.group().strip()] = glyphs
for case in cases:
    case['glyphs'] = rows[case['id']]
assert len(rows) == len(cases) == 162
(root/'reference.json').write_text(json.dumps({'referenceVersion':'16.0.20326','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'pages':len(doc),'cases':cases}, indent=2, ensure_ascii=False)+'\n',encoding='utf-8')
print(f'Recorded {len(cases)} reference small-cap size controls on {len(doc)} pages')
