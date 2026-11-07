"""Record native PDF text paint; never derive expectations from the renderer."""
from pathlib import Path
import hashlib
import json
from pypdf import PdfReader
from pypdf.generic import ContentStream

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/heavy-face-bold'
cases = json.loads((root / 'cases.json').read_text(encoding='utf-8'))
reader = PdfReader(root / 'native.pdf')
samples = []
for page_index, page in enumerate(reader.pages):
    state = {'mode': 0, 'strokeWidth': 1, 'font': None, 'size': 0}
    stack = []
    fonts = page['/Resources']['/Font']
    for args, op in ContentStream(page.get_contents(), reader).operations:
        if op == b'q':
            stack.append(state.copy())
        elif op == b'Q':
            state = stack.pop()
        elif op == b'Tr':
            state['mode'] = int(args[0])
        elif op == b'w':
            state['strokeWidth'] = float(args[0])
        elif op == b'Tf':
            state['font'] = str(fonts[args[0]].get_object()['/BaseFont'])
            state['size'] = float(args[1])
        elif op in (b'Tj', b'TJ') and state['size'] > 11.5:
            samples.append({'page': page_index + 1, **state})
assert len(cases) == len(samples) == 72, (len(cases), len(samples))
for case, sample in zip(cases, samples):
    assert abs(case['size'] - sample['size']) < .02, (case, sample)
    sample['case'] = case
sha = lambda name: hashlib.sha256((root / name).read_bytes()).hexdigest()
result = {'referenceBuild': '16.0.20326', 'sourceSha256': sha('control.docx'),
          'casesSha256': sha('cases.json'), 'pdfSha256': sha('native.pdf'),
          'pageCount': len(reader.pages), 'samples': samples}
(root / 'reference.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(f'Recorded {len(samples)} native text paints on {len(reader.pages)} pages.')
