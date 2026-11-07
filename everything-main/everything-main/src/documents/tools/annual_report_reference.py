"""Record table text origins from an unchanged, native reference PDF export."""
from pathlib import Path
from hashlib import sha256
from pypdf import PdfReader
import json
import shutil
import sys

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/annual-report-origin'
folder.mkdir(exist_ok=True)
pdf = Path(sys.argv[1]).resolve()
positions = {}
for index, page in enumerate(PdfReader(pdf).pages):
    def visit(text, cm, tm, font, size):
        label = text.strip()
        if label.startswith('Cell ') or label == 'Floating cell':
            assert label not in positions, label
            positions[label] = dict(page=index, x=tm[4]*cm[0] + tm[5]*cm[2] + cm[4])
    page.extract_text(visitor_text=visit)
assert len(positions) == 9, positions
shutil.copyfile(pdf, folder / 'native.pdf')
reference = dict(referenceVersion='16.0.20326',
    sourceSha256=sha256((root / 'public/fixtures/annual-report.docx').read_bytes()).hexdigest(),
    pdfSha256=sha256(pdf.read_bytes()).hexdigest(), positions=positions)
(folder / 'reference.json').write_text(json.dumps(reference, indent=2)+'\n', encoding='utf-8')
