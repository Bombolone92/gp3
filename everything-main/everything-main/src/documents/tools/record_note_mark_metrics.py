from pathlib import Path
from hashlib import sha256
from pypdf import PdfReader
import json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/note-mark-metrics'
cases=json.loads((root/'cases.json').read_text())
reader=PdfReader(root/'native.pdf')
assert len(reader.pages)==len(cases)
for case,page in zip(cases,reader.pages):
    spans=[]
    def visit(text,cm,tm,font,size):
        if text.strip():spans.append(dict(text=text.strip(),x=tm[4],baseline=792-tm[5],size=float(size)))
    page.extract_text(visitor_text=visit)
    case['spans']=spans
    print(case['name'],[(s['text'],round(s['baseline'],3),s['size']) for s in spans if not s['text'].startswith('Case')])
reference=dict(referenceBuild='16.0.20326',sourceSha256=sha256((root/'control.docx').read_bytes()).hexdigest(),pdfSha256=sha256((root/'native.pdf').read_bytes()).hexdigest(),cases=cases)
(root/'reference.json').write_text(json.dumps(reference,indent=2)+'\n')
