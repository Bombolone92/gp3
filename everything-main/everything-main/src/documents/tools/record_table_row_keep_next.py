"""Record native reference PDF text origins for independently authored keep controls."""
from pathlib import Path
import ctypes
import hashlib
import json
import pypdfium2 as pdf

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/table-row-keep-next'
cases = []
for name in ['none', 'first', 'second', 'first-start', 'first-end']:
    document = pdf.PdfDocument(folder / f'{name}.pdf')
    lines = []
    for page_index, page in enumerate(document):
        text_page = page.get_textpage()
        for label in ['Before', 'Row one', 'Neighbor one', 'Final label', 'Tail']:
            found = text_page.search(label, match_case=True, match_whole_word=True).get_next()
            if found is None:
                continue
            index, count = found
            x, y = ctypes.c_double(), ctypes.c_double()
            pdf.raw.FPDFText_GetCharOrigin(text_page, index, ctypes.byref(x), ctypes.byref(y))
            lines.append(dict(text=label, page=page_index, x=x.value, baseline=page.get_height() - y.value))
    assert len(lines) == 5, name
    sha = lambda ext: hashlib.sha256((folder / f'{name}.{ext}').read_bytes()).hexdigest()
    cases.append(dict(name=name, pages=len(document), sourceSha256=sha('docx'), pdfSha256=sha('pdf'), lines=lines))
(folder / 'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326', cases=cases), indent=2) + '\n')
