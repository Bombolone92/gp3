"""Record native reference text baselines and marker ink independently of the app."""
from pathlib import Path
import pypdfium2 as P
import ctypes as C
import json, hashlib

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/font-encoded-bullets'
cases = json.loads((folder / 'cases.json').read_text(encoding='utf-8'))
for case, page in zip(cases, P.PdfDocument(folder / 'native.pdf')):
    text = page.get_textpage()
    lines = {}
    for i in range(text.count_chars()):
        char = text.get_text_range(i, 1)
        x, y = C.c_double(), C.c_double()
        P.raw.FPDFText_GetCharOrigin(text, i, C.byref(x), C.byref(y))
        baseline = round(page.get_height() - y.value, 4)
        if char not in '\r\n':
            lines[baseline] = lines.get(baseline, '') + char
    case['lines'] = [dict(text=s[s.index(case['id']):].strip(), y=y) for y, s in lines.items() if case['id'] in s]
    assert len(case['lines']) == 2
    image = page.render(scale=4).to_pil().convert('RGB')
    points = [(x, y) for y in range(60*4, 110*4) for x in range(68*4, 102*4) if max(image.getpixel((x, y))) < 100]
    assert points
    case['ink'] = [min(x for x,y in points)/4, min(y for x,y in points)/4, (max(x for x,y in points)+1)/4, (max(y for x,y in points)+1)/4]
    case['area'] = len(points)/16
(folder / 'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326', cases=cases, hashes={n: hashlib.sha256((folder/n).read_bytes()).hexdigest() for n in ['font-encoded-bullets.docx', 'native.pdf']}), indent=2)+'\n', encoding='utf-8')
