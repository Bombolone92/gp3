"""Measure the explicit NBSP-to-W spans in the original native reference PDF.

Usage: python tools/record_legacy_nbsp.py <font-metadata.json> <output.json>
Font metadata comes from inspect-legacy-space-fonts.mjs. No font bytes are read
or persisted here. This is evidence for these controls, not a shaping engine.
"""
from pathlib import Path
from hashlib import sha256
import json
import sys
from pypdf import PdfReader
from pypdf.generic import ContentStream

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/legacy-space-variants'
fonts = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
cases = json.loads((folder / 'cases.json').read_text())
reference = json.loads((folder / 'reference.json').read_text())
digest = lambda path: sha256(path.read_bytes()).hexdigest()
assert digest(folder / 'control.docx') == reference['sourceSha256']
assert digest(folder / 'native.pdf') == reference['pdfSha256']
reader = PdfReader(folder / 'native.pdf')
observations = []
for page_index, page in enumerate(reader.pages):
    spans = []
    font, size, x, y = None, None, 0, 0
    for args, op in ContentStream(page.get_contents(), reader).operations:
        if op == b'cm':
            assert [float(v) for v in args] == [1, 0, 0, 1, 0, 0], 'Unexpected page coordinate transform'
        if op == b'Tz':
            assert float(args[0]) == 100, 'Unexpected text horizontal scaling'
        if op == b'Ts':
            assert float(args[0]) == 0, 'Unexpected text rise'
        if op == b'Tf':
            font, size = str(args[0]), float(args[1])
        elif op == b'Tm':
            assert [float(v) for v in args[:4]] == [1, 0, 0, 1]
            x, y = float(args[4]), float(args[5])
        elif op in [b'TJ', b'Tj']:
            values = args[0] if op == b'TJ' else args
            text = ''.join(value for value in values if isinstance(value, str))
            spans.append(dict(text=text, x=x, y=y, font=font, size=size))
    for left, right in zip(spans, spans[1:]):
        if left['text'] == ' ' and right['text'].startswith('W') and left['font'] == right['font'] and left['y'] == right['y']:
            observations.append(dict(page=page_index, x=left['x'], y=left['y'], size=left['size'],
                                     pdfFont=str(page['/Resources']['/Font'][left['font']]['/BaseFont']),
                                     pdfSpaceCode=32, advancePt=right['x']-left['x']))
assert len(observations) == len(cases) == 48
rows = []
for case, native, line in zip(cases, observations, reference['lines']):
    assert native['page'] == line['page'] and native['y'] == line['y']
    assert native['size'] == case['size']
    matches = [f for f in fonts if f['weight'] == (700 if case['bold'] else 400) and f['italic'] == case['italic'] and f['widthClass'] == 5]
    assert len(matches) == 1
    face = matches[0]
    expected = (face['space']['advance'] + (face['spaceW'] if case['kern'] else 0)) / face['unitsPerEm'] * case['size'] + case['spacing']
    literal = (face['nbsp']['advance'] + (face['nbspW'] if case['kern'] else 0)) / face['unitsPerEm'] * case['size'] + case['spacing']
    rows.append(dict(**case, native=native, ordinarySpacePredictionPt=expected,
                     literalNbspPredictionPt=literal, ordinarySpaceErrorPt=native['advancePt']-expected,
                     literalNbspErrorPt=native['advancePt']-literal))
result = dict(baseline='58619739', referenceVersion=reference['referenceVersion'],
              sha256={name: digest(folder / name) for name in ['control.docx', 'native.pdf', 'cases.json']},
              fonts=fonts, rows=rows,
              maxOrdinarySpacePredictionErrorPt=max(abs(row['ordinarySpaceErrorPt']) for row in rows),
              scope='Four normal-width Rockwell faces, 12/18 pt, three spacing values, kerning on/off. Native PDF positions are quantized; this is not exact advance equivalence or a general NBSP normalization rule.')
Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(f'Recorded {len(rows)} native NBSP advances. Maximum ordinary-space prediction error: {result["maxOrdinarySpacePredictionErrorPt"]:.6f} pt.')
