"""Record native baselines and font attributes for dormant CS properties."""
from pathlib import Path
from hashlib import sha256
import ctypes
import json
import pypdfium2 as P
import pypdfium2.raw as R

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/complex-script-properties'
pdf = P.PdfDocument(root / 'native.pdf')
pages = []
for page in pdf:
    text = page.get_textpage()
    lines = []
    for i in range(text.count_chars()):
        code = R.FPDFText_GetUnicode(text, i)
        if code < 32:
            continue
        x, y = ctypes.c_double(), ctypes.c_double()
        assert R.FPDFText_GetCharOrigin(text, i, ctypes.byref(x), ctypes.byref(y))
        baseline = page.get_height() - y.value
        font, flags = ctypes.create_string_buffer(256), ctypes.c_int()
        R.FPDFText_GetFontInfo(text, i, font, 256, ctypes.byref(flags))
        if not lines or abs(lines[-1]['baseline'] - baseline) > .01:
            lines.append(dict(text='', baseline=baseline, x=x.value, fonts=[]))
        lines[-1]['text'] += chr(code)
        attributes = dict(name=font.value.decode(), size=R.FPDFText_GetFontSize(text, i), weight=R.FPDFText_GetFontWeight(text, i))
        if attributes not in lines[-1]['fonts']:
            lines[-1]['fonts'].append(attributes)
    pages.append(lines)
result = dict(referenceVersion='16.0.20326', pages=pages)
for name, key in [('control.docx', 'sourceSha256'), ('native.pdf', 'pdfSha256')]:
    result[key] = sha256((root / name).read_bytes()).hexdigest()
(root / 'reference.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
