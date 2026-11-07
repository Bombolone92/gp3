"""Extract native reference text baselines; engine-independent original controls."""
from pathlib import Path
from pypdf import PdfReader
import hashlib
import json

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/inline-picture-run-metrics'
for name in ['source', 'modern', 'spacing']:
    pdf_name = 'native' if name == 'source' else name + '-native'
    pages = []
    for page in PdfReader(folder / (pdf_name + '.pdf')).pages:
        baselines = {}
        def visit(text, cm, tm, font, size):
            text = text.strip()
            if text in ['Before', 'Tail', 'After']:
                assert text not in baselines
                baselines[text] = float(page.mediabox.height) - (tm[4]*cm[1] + tm[5]*cm[3] + cm[5])
        page.extract_text(visitor_text=visit)
        assert len(baselines) == 3
        pages.append(baselines)
    result = dict(referenceVersion='16.0.20326', pages=pages,
                  sourceSha256=hashlib.sha256((folder/(name+'.docx')).read_bytes()).hexdigest(),
                  pdfSha256=hashlib.sha256((folder/(pdf_name+'.pdf')).read_bytes()).hexdigest())
    (folder/(name+'-reference.json')).write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
