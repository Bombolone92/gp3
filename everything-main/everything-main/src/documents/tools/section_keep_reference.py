"""Record page assignment and text origins from independent reference controls."""
from pathlib import Path
from pypdf import PdfReader
import hashlib,json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/section-keep'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
cases=json.loads((root/'cases.json').read_text(encoding='utf8'))
for case in cases:
    source=root/(case['name']+'.docx');pdf=root/(case['name']+'-native.pdf')
    reader=PdfReader(pdf);runs=[]
    for i,page in enumerate(reader.pages):
        def visit(text,ctm,matrix,font,size):
            text=text.strip()
            if not text:return
            assert text in ['INTRO','TARGET','BOUNDARY','AFTER'],text
            assert ctm[:4]==[1,0,0,1] and matrix[:4]==[1,0,0,1]
            runs.append(dict(text=text,page=i,x=matrix[4],y=float(page.mediabox.height)-matrix[5]))
        page.extract_text(visitor_text=visit)
    assert [r['text'] for r in runs]==['INTRO']+(['TARGET'] if case.get('target','TARGET') else [])+(['BOUNDARY'] if case.get('boundary') else [])+['AFTER']
    case.update(sourceSha256=sha(source),pdfSha256=sha(pdf),pageCount=len(reader.pages),runs=runs)
    print(case['name'],case['pageCount'],[(r['text'],r['page']) for r in runs])
(root/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',cases=cases),indent=2)+'\n',encoding='utf8')
