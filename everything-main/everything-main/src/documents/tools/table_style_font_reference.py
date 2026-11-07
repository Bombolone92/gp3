"""Extract the two independent reference font-size control probes."""
import json
import hashlib
from pathlib import Path
from pypdf import PdfReader

root=Path(__file__).resolve().parents[1]
for suffix in ['', '-12']:
    folder=root/f'tests/fixtures/table-style-font-defaults{suffix}'
    lines={}
    for i,page in enumerate(PdfReader(folder/'native.pdf').pages):
        def text(value,cm,tm,font,size):
            if value.strip():
                key=(i,round(tm[5],2))
                line=lines.setdefault(key,{'text':'','size':size})
                line['text']+=value.strip()
        page.extract_text(visitor_text=text)
    result={line['text'][5:]:line['size'] for line in lines.values() if line['text'].startswith('Cell_')}
    assert len(result)==13,result
    (folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    paths=[root/f'public/fixtures/table-style-font-defaults{suffix}.docx',folder/'native.pdf']
    (folder/'manifest.json').write_text(json.dumps({p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},indent=2)+'\n',encoding='utf-8')
    print(suffix or '16',result)
