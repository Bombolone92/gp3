"""Record reference baselines independently of app layout."""
from pathlib import Path
from pypdf import PdfReader
import hashlib, json, re, sys
ROOT = Path(__file__).resolve().parents[1]
name = sys.argv[1] if len(sys.argv) > 1 else 'paragraph-line-units'
folder = ROOT / 'tests/fixtures' / name
source = ROOT / 'public/fixtures' / (name + '.docx')
pdf = folder / 'native.pdf'
cases = json.loads((folder / 'cases.json').read_text())
doc = PdfReader(pdf)
assert len(doc.pages) == len(cases)
for page, c in zip(doc.pages, cases):
    labels = []
    def visit(text, cm, tm, font, size):
        if re.fullmatch(r'K\d{2}[ABCD]', text.strip()):
            labels.append(dict(text=text.strip(), x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4], y=float(page.mediabox.top)-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5])))
    page.extract_text(visitor_text=visit)
    assert len(labels) == 4
    c['labels'] = labels
    c['gap'] = round(labels[2]['y'] - 2 * labels[1]['y'] + labels[0]['y'], 4)
    print(c['id'], c['side'], c['size'], c['rule'], c['line'], c['units'], {k:c[k] for k in ['absolute','markSize','inherited','auto'] if k in c}, 'gap', c['gap'])
(folder / 'reference.json').write_text(json.dumps(dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(), pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(), referenceVersion='16.0.20326', cases=cases), indent=2) + '\n')
