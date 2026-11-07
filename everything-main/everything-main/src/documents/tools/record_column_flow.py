"""Record native reference PDF text coordinates for the original column controls."""
from pathlib import Path
import hashlib
import json
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/column-flow'


def record(name, root=ROOT, expected=None):
    source = root / (name + '.docx'); native = source.with_suffix('.pdf')
    pdf = PdfReader(native); lines = []
    for page_index, page in enumerate(pdf.pages):
        def visit(text, cm, tm, font, size):
            if text.strip():
                lines.append(dict(page=page_index, text=text.strip(),
                    x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4],
                    baseline=float(page.mediabox.height)-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5])))
        page.extract_text(visitor_text=visit)
    if expected is None:
        expected = 30 if name in ['equal-flow', 'unequal', 'separator'] else 5 if name == 'short' else 21 if name == 'table-flow' else 3
    assert len(lines) == expected, (name, len(lines), expected)
    result = dict(referenceBuild='16.0.20326', sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
        pdfSha256=hashlib.sha256(native.read_bytes()).hexdigest(), pages=len(pdf.pages), lines=lines)
    (root / (name + '-reference.json')).write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print(name, result['pages'], 'pages;', len(lines), 'lines;', 'x origins', sorted({round(x['x'], 3) for x in lines}))


if __name__ == '__main__':
    for name in ['short', 'equal-flow', 'unequal', 'separator', 'explicit-break', 'wide-table', 'page-break', 'table-flow']:
        record(name)
