"""Record original rotated-label controls from the installed reference application's PDF export."""
from pathlib import Path
from pypdf import PdfReader
import hashlib
import json

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/cell-text-direction/reading-axis'
pages = []
for page in PdfReader(folder / 'native.pdf').pages:
    runs = []
    def visit(text, cm, tm, font, size):
        if text.strip():
            runs.append(dict(text=text.strip(), cm=cm, tm=tm,
                             font=str(font.get('/BaseFont')), size=size))
    page.extract_text(visitor_text=visit)
    pages.append(dict(height=float(page.mediabox.height), runs=runs))
assert len(pages) == 4
assert all(len([r for r in p['runs'] if abs(r['tm'][1]) > .9]) == 9 for p in pages)
result = dict(referenceBuild='16.0.20326', pages=pages,
              hashes={name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
                      for name in ['control.docx', 'native.pdf']})
(folder / 'reference.json').write_text(json.dumps(result, indent=2) + '\n')
