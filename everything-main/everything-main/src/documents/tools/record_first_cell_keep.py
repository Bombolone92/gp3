from pathlib import Path
from pypdf import PdfReader
import json,hashlib
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/first-cell-keep'
refs={}
for p in sorted(folder.glob('*.docx')):
 pdf=p.with_name(p.stem+'-native.pdf');pages=[x.extract_text() for x in PdfReader(pdf).pages]
 refs[p.stem]={'pages':len(pages),'markers':{m:[i for i,t in enumerate(pages) for _ in range(t.count(m))] for m in ['Heading','Tail','Spacer','Line 1','Line 4','Line 6','After table']},'hashes':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in [p,pdf]}}
(folder/'reference.json').write_text(json.dumps(refs,indent=2)+'\n')
print(json.dumps({n:r['markers']['Line 1'] for n,r in refs.items()}))
