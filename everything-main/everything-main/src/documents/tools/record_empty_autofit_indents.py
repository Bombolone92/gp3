"""Record independent reference shaded-cell bounds at four pixels per point."""
from pathlib import Path
import pypdfium2 as P
import json,hashlib
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/empty-autofit-indents'
cases=json.loads((folder/'cases.json').read_text());records=[]
for case,page in zip(cases,P.PdfDocument(folder/'native.pdf')):
    im=page.render(scale=4).to_pil().convert('RGB');xs=[]
    for y in range(140,400):
        for x in range(im.width):
            r,g,b=im.getpixel((x,y))
            if g>200 and r<40 and b<40:xs.append(x)
    assert xs
    records.append(dict(name=case[0],left=min(xs)/4,right=(max(xs)+1)/4))
(folder/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',cases=records,hashes={n:hashlib.sha256((folder/n).read_bytes()).hexdigest() for n in ['control.docx','native.pdf']}),indent=2)+'\n')
