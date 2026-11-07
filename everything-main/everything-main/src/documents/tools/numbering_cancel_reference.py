"""Record native reference image origins, independently of the application layout."""
from pathlib import Path
from pypdf import PdfReader
import hashlib, json
ROOT = Path(__file__).resolve().parents[1]
for name in ['numbering-cancel-indent', 'numbering-cancel-direct', 'numbering-cancel-style']:
    folder = ROOT / 'tests/fixtures' / name
    pictures = []
    for page, source in enumerate(PdfReader(folder / 'native.pdf').pages):
        def visit(op, args, cm, tm):
            if op == b'Do':
                pictures.append(dict(page=page, x=cm[4], width=cm[0]))
        source.extract_text(visitor_operand_before=visit)
    assert len(pictures) == (8 if name.endswith('indent') else 24 if name.endswith('style') else 10)
    result = dict(referenceVersion='16.0.20326', pictures=pictures,
        sourceSha256=hashlib.sha256((ROOT/'public/fixtures'/f'{name}.docx').read_bytes()).hexdigest(),
        pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest())
    (folder/'reference.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
