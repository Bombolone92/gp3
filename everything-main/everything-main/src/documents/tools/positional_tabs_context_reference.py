"""Capture marker positions in PDF painting order for contextual controls."""
from pathlib import Path
from pypdf import PdfReader
import hashlib
import json
import sys

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/positional-tabs'
name = sys.argv[1] if len(sys.argv) > 1 else 'contexts'
pdf = PdfReader(folder / (name + '-native.pdf'))
pages = []
for page in pdf.pages:
    markers = []
    def visit(operator, args, matrix, text_matrix):
        if operator != b'Do':
            return
        color = ''.join(f'{v:02x}' for v in page.images[str(args[0])].image.convert('RGB').getpixel((0, 0)))
        assert color in ['777777', 'e03040', '2050d0']
        a, b, c, d, x, y = matrix
        assert b == c == 0 and a == d == 4
        markers.append(dict(color=color, x=x, y=float(page.mediabox.top)-y-d, width=a))
    page.extract_text(visitor_operand_before=visit)
    pages.append(markers)
result = dict(referenceVersion='16.0.20326',
              sourceSha256=hashlib.sha256((folder/(name+'.docx')).read_bytes()).hexdigest(),
              pdfSha256=hashlib.sha256((folder/(name+'-native.pdf')).read_bytes()).hexdigest(), pages=pages)
(folder/(name+'-reference.json')).write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
print(f'Captured {len(pages)} pages, {sum(map(len,pages))} markers')
