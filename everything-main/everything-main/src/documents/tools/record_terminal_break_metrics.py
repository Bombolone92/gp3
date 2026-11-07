"""Record page assignments and visible baselines from native reference exports."""
from pathlib import Path
import ctypes, hashlib, json
import pypdfium2 as pdfium

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/terminal-break-metrics'
result = []
for path in sorted(folder.glob('*.pdf')):
    source = root / f'public/fixtures/break-metrics-{path.stem}.docx'
    pdf = pdfium.PdfDocument(path)
    labels = []
    for page_index, page in enumerate(pdf):
        text = page.get_textpage()
        full = text.get_text_range()
        for label in ['Before', 'After', 'X']:
            index = full.find(label)
            if index < 0:
                continue
            x, y = ctypes.c_double(), ctypes.c_double()
            pdfium.raw.FPDFText_GetCharOrigin(text, index, ctypes.byref(x), ctypes.byref(y))
            labels.append(dict(text=label, page=page_index, x=x.value, baseline=page.get_height()-y.value))
    assert sum(l['text'] == 'After' for l in labels) == 1
    result.append(dict(name=path.stem, pages=len(pdf), labels=labels,
                       sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                       pdfSha256=hashlib.sha256(path.read_bytes()).hexdigest()))
(folder / 'reference.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
