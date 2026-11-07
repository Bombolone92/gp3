"""Record native origins and bind the authored controls and reference evidence."""
from pathlib import Path
import ctypes
import hashlib
import json
import pypdfium2 as pdfium

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/default-kerning'
cases = json.loads((folder / 'cases.json').read_text())
com = {c['name']: c for c in json.loads((folder / 'native-com.json').read_text(encoding='utf-8-sig'))}
records = []
files = ['cases.json', 'native-com.json']
for case in cases:
    name = case['name']
    files.extend([name + '.docx', name + '-native.pdf'])
    pdf = pdfium.PdfDocument(folder / (name + '-native.pdf'))
    assert len(pdf) == 1
    page = pdf[0]
    text = page.get_textpage()
    lines = []
    for i in range(text.count_chars()):
        c = text.get_text_range(i, 1)
        if c in '\r\n':
            continue
        x, y = ctypes.c_double(), ctypes.c_double()
        pdfium.raw.FPDFText_GetCharOrigin(text, i, ctypes.byref(x), ctypes.byref(y))
        baseline = page.get_height() - y.value
        if not lines or abs(lines[-1]['baseline'] - baseline) > .2:
            lines.append(dict(text='', baseline=baseline, glyphs=[]))
        lines[-1]['text'] += c
        lines[-1]['glyphs'].append(x.value)
    assert len(lines) == len(case['rows']) == len(com[name]['thresholds'])
    for line, row in zip(lines, case['rows']):
        line['text'] = line['text'].rstrip()
        line['glyphs'] = line['glyphs'][:len(line['text'])]
        assert line['text'] == row['text']
    records.append(dict(name=name, lines=lines, **{k: v for k, v in com[name].items() if k != 'name'}))
reference = dict(cases=records, sha256={f: hashlib.sha256((folder / f).read_bytes()).hexdigest() for f in files})
(folder / 'reference.json').write_text(json.dumps(reference, indent=2) + '\n', encoding='utf-8')
