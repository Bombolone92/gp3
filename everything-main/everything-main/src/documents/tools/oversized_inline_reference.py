"""Record full and visible reference picture rectangles independently (points)."""
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
import hashlib, json
ROOT = Path(__file__).resolve().parents[1]
folder = ROOT / 'tests/fixtures/oversized-inline'
result = []
for page, source in enumerate(PdfReader(folder / 'native.pdf').pages):
    def visit(op, args, cm, tm):
        if op == b'Do':
            assert cm[1] == cm[2] == 0
            result.append(dict(page=page, x=cm[4], top=float(source.mediabox.height)-cm[5]-cm[3], width=cm[0], height=cm[3]))
    source.extract_text(visitor_operand_before=visit)
assert len(result) == 6
# Image placement matrices retain the full source rectangle even when a PDF
# clipping path hides its right edge. Measure the original two-color artwork
# in the rendered PDF independently of that placement geometry.
pdf = pdfium.PdfDocument(folder / 'native.pdf')
for picture in result:
    raster = pdf[picture['page']].render(scale=4).to_pil().convert('RGB')
    y = int((picture['top'] + picture['height'] / 2) * 4)
    xs = [x for x in range(raster.width) if (lambda r, g, b: r < 100 and g < 160 and b > 120 or r > 180 and 50 < g < 160 and b < 100)(*raster.getpixel((x, y)))]
    assert xs
    picture.update(visibleX=min(xs)/4, visibleWidth=(max(xs)-min(xs)+1)/4)
(folder / 'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326', sourceSha256=hashlib.sha256((ROOT/'public/fixtures/oversized-inline.docx').read_bytes()).hexdigest(), pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(), pictures=result), indent=2)+'\n', encoding='utf-8')
