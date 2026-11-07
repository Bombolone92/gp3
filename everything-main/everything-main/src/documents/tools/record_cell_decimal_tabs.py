"""Record native PDF text origins independently of browser layout."""
from pathlib import Path
import hashlib,json,re
from pypdf import PdfReader
OUT=Path(__file__).resolve().parents[1]/'tests/fixtures/cell-decimal-tabs'
cases=json.loads((OUT/'cases.json').read_text(encoding='utf8'))
for name in ['mode12','mode15','mode12-auto','mode15-auto']:
    records=[[] for _ in cases]
    current=None
    reader=PdfReader(OUT/f'{name}-native.pdf')
    for page_index,page in enumerate(reader.pages):
        height=float(page.mediabox.height)
        def visitor(text,cm,tm,font,size):
            global current
            text=text.strip('\r\n')
            if not text.strip():return
            label=re.fullmatch(r'Case (\d+)',text.strip())
            if label:current=int(label[1])-1;return
            assert current is not None
            records[current].append(dict(text=text,page=page_index,x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4],y=height-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5]),fontSize=size))
        page.extract_text(visitor_text=visitor)
    assert current==len(cases)-1
    result=dict(cases=records,pages=len(reader.pages),hashes={file:hashlib.sha256((OUT/file).read_bytes()).hexdigest() for file in ['cases.json',f'{name}.docx',f'{name}-native.pdf']})
    (OUT/f'{name}-text.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    print(name)
    for i,(c,r) in enumerate(zip(cases,records)):print(i+1,repr(c['text']),[(t['text'],t['x'],t['y']) for t in r])
