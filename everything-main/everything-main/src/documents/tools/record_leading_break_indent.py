from pathlib import Path
from hashlib import sha256
from pypdf import PdfReader
import json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/leading-break-indent'
cases=[]
for name in ['page','column','text','space','tab','line','double','positive','numbered']:
    source=root/(name+'.docx'); native=root/(name+'-native.pdf')
    reader=PdfReader(native); positions=[]
    for page_index,page in enumerate(reader.pages):
        def visit(text,cm,tm,font,size):
            if text.startswith('START'):
                positions.append(dict(page=page_index,x=tm[4],baseline=float(page.mediabox.height)-tm[5],text=text))
        page.extract_text(visitor_text=visit)
    assert len(positions)==1,(name,positions)
    cases.append(dict(name=name,sourceSha256=sha256(source.read_bytes()).hexdigest(),pdfSha256=sha256(native.read_bytes()).hexdigest(),pages=len(reader.pages),first=positions[0]))
(root/'reference.json').write_text(json.dumps(dict(referenceBuild='16.0.20326',cases=cases),indent=2),encoding='utf8')
print([(c['name'],c['first']['page'],c['first']['x']) for c in cases])
