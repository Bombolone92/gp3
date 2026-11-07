"""Extract native PDF text colors without consulting the renderer's conversion."""
import argparse
import ctypes
import hashlib
import json
from pathlib import Path
import pypdfium2 as pdf

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory', type=Path)
parser.add_argument('--source', default='control.docx', help='Authored source filename within directory')
args = parser.parse_args()
root = args.directory
cases = json.loads((root / 'cases.json').read_text())
refs = []
document = pdf.PdfDocument(root / 'native.pdf')
for page_index, page in enumerate(document):
    text = page.get_textpage()
    for index in range(text.count_chars()):
        label = text.get_text_range(index, 4)
        if len(label) != 4 or label[0] != 'C' or not label[1:].isdigit():
            continue
        rgba = [ctypes.c_uint() for _ in range(4)]
        if not pdf.raw.FPDFText_GetFillColor(text, index, *[ctypes.byref(v) for v in rgba]):
            raise RuntimeError(f'Cannot extract fill for {label}')
        if rgba[3].value != 255:
            raise RuntimeError(f'Unexpected transparency for {label}')
        refs.append(dict(label=label, page=page_index, rgb=[v.value for v in rgba[:3]]))
refs.sort(key=lambda item: item['label'])
if [r['label'] for r in refs] != [c['label'] for c in cases]:
    raise RuntimeError('Native labels do not match the independent case inventory')
result = dict(
    sourceSha256=hashlib.sha256((root / args.source).read_bytes()).hexdigest(),
    pdfSha256=hashlib.sha256((root / 'native.pdf').read_bytes()).hexdigest(),
    casesSha256=hashlib.sha256((root / 'cases.json').read_bytes()).hexdigest(),
    pages=len(document), colors=refs,
)
(root / 'reference.json').write_text(json.dumps(result, indent=2) + '\n')
print(f'Recorded {len(refs)} native colors across {len(document)} pages')
