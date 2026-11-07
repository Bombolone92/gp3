"""Record the reference's independently measured text origins, without engine output."""
from pathlib import Path
import hashlib, json
from pypdf import PdfReader
import pypdfium2 as pdfium
root = Path(__file__).resolve().parents[1]
source = root / 'public/fixtures/cell-margin-reset.docx'
pdf = root / 'tests/fixtures/cell-margin-reset/native.pdf'
pages = []
for page in PdfReader(pdf).pages:
    lines = []
    def visit(text, cm, tm, font, size):
        text = text.strip()
        if text.startswith('M'):
            assert size == 12 and 'CourierNew' in font['/BaseFont']
            lines.append(dict(text=text, x=tm[4], baseline=792-tm[5]))
    page.extract_text(visitor_text=visit)
    assert len(lines) == 4
    pages.append(lines)
assert len(pages) == 22
rendered = pdfium.PdfDocument(pdf)
for i, lines in enumerate(pages):
    im = rendered[i].render(scale=4).to_pil().convert('RGB')
    for line in lines:
        top, bottom = round((line['baseline']-13)*4), round((line['baseline']+3)*4)
        points = [(x,y) for y in range(top,bottom) for x in range(100*4,500*4) if max(im.getpixel((x,y))) < 80]
        assert points
        line['ink'] = [min(x for x,y in points)/4, min(y for x,y in points)/4, (max(x for x,y in points)+1)/4, (max(y for x,y in points)+1)/4]
data = dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(), pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(), referenceVersion='16.0.20326', pages=pages)
(pdf.parent / 'reference.json').write_text(json.dumps(data, indent=2)+'\n')
