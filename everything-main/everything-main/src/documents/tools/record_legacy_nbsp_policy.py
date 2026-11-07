"""Record explicit reference PDF positions independently of its text-layer font names."""
from pathlib import Path
import hashlib
import json
import sys
from pypdf import PdfReader
from pypdf.generic import ContentStream

folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'tests/fixtures/legacy-nbsp-font-policy'
cases = json.loads((folder / 'cases.json').read_text())
pdf = PdfReader(folder / 'native.pdf')
assert len(pdf.pages) == 1
page = pdf.pages[0]
assert list(map(float, page.mediabox)) == [0, 0, 612, 792] and not page.get('/Rotate', 0)
groups = {}
size = None
position = None
identity = True
graphics = []
for values, operator in ContentStream(page.get_contents(), pdf).operations:
    if operator == b'q':
        graphics.append(identity)
    elif operator == b'Q':
        identity = graphics.pop()
    elif operator == b'cm':
        identity = identity and list(map(float, values)) == [1, 0, 0, 1, 0, 0]
    elif operator == b'Tf':
        size = float(values[1])
    elif operator == b'Tm':
        assert identity, 'Unsupported text-space transform'
        assert list(map(float, values[:4])) == [1, 0, 0, 1]
        position = tuple(map(float, values[4:]))
    elif operator in (b'Tj', b'TJ'):
        assert position is not None
        strings = values if operator == b'Tj' else values[0]
        text = ''.join(str(value) for value in strings if isinstance(value, str))
        assert all(isinstance(value, str) or float(value) == 0 for value in strings), 'Unexpected in-span positioning'
        groups.setdefault(position[1], []).append({'x': position[0], 'size': size, 'text': text})
        position = None
assert len(groups) == len(cases) == 12
rows = []
for case, (y, spans) in zip(cases, sorted(groups.items(), reverse=True)):
    body = [span for span in spans if span['size'] == 36]
    ending = [span for span in spans if span['size'] == 12]
    assert ''.join(span['text'] for span in body) == case['text'].replace('\u00a0', ' ')
    assert len(ending) == 1 and ending[0]['text'] == ' '
    expected_width = (2 * case['aAdvance'] + 700 + 250 - (100 if case['kern'] else 0)) * .036
    origin, end = body[0]['x'], ending[0]['x']
    assert abs(origin - (612 - expected_width) / 2) < .2
    assert abs(end - origin - expected_width) < .2
    row = {**case, 'baseline': y, 'origin': origin, 'end': end, 'expectedSpaceWidth': expected_width, 'spans': spans}
    if '\u00a0' in case['text']:
        assert [span['text'] for span in body] == ['A', ' ', 'WA']
        marker = body[1]['x'] - origin
        separator = body[2]['x'] - body[1]['x']
        assert abs(marker - case['aAdvance'] * .036) < .2, 'Wrong source-face marker advance'
        assert abs(separator - (250 - (100 if case['kern'] else 0)) * .036) < .2
        row.update(markerAdvance=marker, separatorAdvance=separator,
                   literalNbspPrediction=(case['width'] - (200 if case['kern'] else 0)) * .036)
    rows.append(row)
for i in range(0, 12, 2):
    assert rows[i]['origin'] == rows[i + 1]['origin'] and rows[i]['end'] == rows[i + 1]['end']
hashes = {name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
          for name in ['control.docx', 'Equal.otf', 'Wide.otf', 'Ink.otf', 'native.pdf', 'native-30.png']}
result = {'referenceBuild': '16.0.20326', 'scope': 'Explicit native text positions only. The PDF text layer names other fonts; use the native screenshot for glyph identity/appearance, not PDF font widths.',
          'sha256': hashes, 'pdfFonts': [str(value.get_object()['/BaseFont']) for value in page['/Resources']['/Font'].values()], 'rows': rows}
(folder / 'reference.json').write_bytes((json.dumps(result, indent=2) + '\n').encode())
print('Verified 12 native widths/origins, six matched space/NBSP pairs, and six distinct-face marker advances.')
