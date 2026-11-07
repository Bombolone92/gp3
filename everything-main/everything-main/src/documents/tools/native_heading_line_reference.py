"""Extract native reference baselines without inferring a correction formula."""
from pathlib import Path
from hashlib import sha256
import json
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/native-heading-line-metrics'
cases = json.loads((ROOT / 'cases.json').read_text(encoding='utf-8'))
reader = PdfReader(ROOT / 'native.pdf')
assert len(reader.pages) == len(cases)
pages = []
for case, page in zip(cases, reader.pages):
    spans = []
    def visit(text, cm, tm, font, size):
        if text.strip():
            spans.append(dict(text=text, x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4],
                              y=float(page.mediabox.height)-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5]),
                              font=str(font.get('/BaseFont', '')), size=size))
    page.extract_text(visitor_text=visit)
    samples = [s for s in spans if s['text'].strip() in ['Alpha', 'Beta', 'Gamma']]
    pages.append(dict(case=case, spans=spans,
                      sampleBaselineSteps=[b['y']-a['y'] for a,b in zip(samples,samples[1:])]))
out = dict(casesSha256=sha256((ROOT/'cases.json').read_bytes()).hexdigest(), sourceSha256=sha256((ROOT/'control.docx').read_bytes()).hexdigest(),
           pdfSha256=sha256((ROOT/'native.pdf').read_bytes()).hexdigest(),
           referenceVersion='16.0.20326', pages=pages)
(ROOT/'reference.json').write_text(json.dumps(out, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
