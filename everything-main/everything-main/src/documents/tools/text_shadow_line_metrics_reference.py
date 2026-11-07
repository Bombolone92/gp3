"""Record reference baselines for original text-effect controls; no engine-derived expectations."""
from pathlib import Path
from pypdf import PdfReader
import hashlib
import json

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/text-shadow-line-metrics'
pdf = PdfReader(folder / 'native.pdf')
assert len(pdf.pages) == 12
pages = []
for index, page in enumerate(pdf.pages):
    lines = []
    def visit(text, cm, tm, font, size):
        if text.strip():
            assert list(cm) == [1, 0, 0, 1, 0, 0], cm
            lines.append({'text': text.strip(), 'x': float(tm[4]), 'y': float(page.mediabox.height) - float(tm[5])})
    page.extract_text(visitor_text=visit)
    assert sum(line['text'] == 'After' for line in lines) == 1
    effect = ['plain', 'shadow', 'outline', 'both'][index % 4]
    assert len(lines) == (4 if effect in ['plain', 'shadow'] else 1)
    pages.append({'face': ['Corbel 16 regular', 'Rockwell 36 bold italic', 'Rockwell 66 bold'][index // 4], 'effect': effect, 'lines': lines})
result = {'referenceVersion': '16.0.20326', 'pages': pages, 'hashes': {
    name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
    for name in ['control.docx', 'native.pdf']}}
result['documents'] = {'control': {'pages': pages}}
for name, cases in json.loads((folder / 'cases.json').read_text()).items():
    native = PdfReader(folder / f'{name}-native.pdf')
    assert len(native.pages) == len(cases)
    recorded = []
    for case, page in zip(cases, native.pages):
        lines = []
        page.extract_text(visitor_text=visit)
        assert sum(line['text'] == 'After' for line in lines) == 1
        recorded.append({'case': case, 'lines': lines})
    result['documents'][name] = {'pages': recorded}
    for part in [f'{name}.docx', f'{name}-native.pdf']:
        result['hashes'][part] = hashlib.sha256((folder / part).read_bytes()).hexdigest()
(folder / 'reference.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
