"""Extract original marker geometry from the native reference PDF, without engine code."""
from pathlib import Path
import hashlib
import json
from pypdf import PdfReader

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/positional-tabs'
cases = json.loads((folder / 'cases.json').read_text())
pdf = PdfReader(folder / 'native.pdf')
assert len(pdf.pages) == len(cases)
pages = []
for case, page in zip(cases, pdf.pages):
    markers = {}

    def visit(operator, arguments, matrix, text_matrix):
        if operator != b'Do':
            return
        image = page.images[str(arguments[0])].image.convert('RGB')
        color = ''.join(f'{channel:02x}' for channel in image.getpixel((0, 0)))
        assert color in ['777777', 'e03040', '2050d0']
        assert color not in markers
        a, b, c, d, x, y = matrix
        assert b == c == 0 and a == d == 4
        markers[color] = dict(x=x, y=float(page.mediabox.top)-y-d, width=a, height=d)

    page.extract_text(visitor_operand_before=visit)
    assert set(markers) == ({'777777', 'e03040', '2050d0'} if case['lead'] else {'e03040', '2050d0'})
    start, end = markers['e03040'], markers['2050d0']
    assert start['y'] == end['y']
    anchor = {'left': start['x'], 'center': (start['x']+end['x']+end['width'])/2,
              'right': end['x']+end['width']}[case['alignment']]
    pages.append(dict(name=case['name'], markers=markers, alignmentAnchor=anchor))

result = dict(referenceVersion='16.0.20326',
              sourceSha256=hashlib.sha256((folder/'source.docx').read_bytes()).hexdigest(),
              pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(), pages=pages)
(folder/'reference.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
print(f'Extracted {len(pages)} native reference pages')
