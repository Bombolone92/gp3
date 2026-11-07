"""Record generated-label fonts/sizes independently from reference PDF text."""
from pathlib import Path
from pypdf import PdfReader
import re,json
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/chart-metadata'
out=[]
for pdf in sorted(folder.glob('*.pdf')):
    r=PdfReader(pdf);labels=[]
    def visitor(t,cm,tm,font,size):
        t=t.strip()
        if re.fullmatch(r'\d+%|Q[1-4]',t):labels.append(dict(text=t,font=str(font.get('/BaseFont')).split('+')[-1],size=size))
    r.pages[0].extract_text(visitor_text=visitor)
    assert len(labels)==15
    out.append(dict(name=pdf.stem,labels=labels))
(folder/'native-text.json').write_text(json.dumps(out,indent=2)+'\n',encoding='utf-8')
