"""Record native colored outline/shadow bounds from the reference PDF, in points."""
from pathlib import Path
from hashlib import sha256
import json
import numpy as np
import pypdfium2 as pdfium

root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/zero-axis-group-effects'
source=root/'public/fixtures/zero-axis-group-effects.docx';pdf=folder/'native.pdf'
doc=pdfium.PdfDocument(pdf);assert len(doc)==1
scale=4
pixels=np.asarray(doc[0].render(scale=scale).to_pil().convert('RGB')).astype(int)
cases=json.loads((folder/'cases.json').read_text(encoding='utf-8'))
def bounds(color,case):
    rgb=np.array([int(color[i:i+2],16) for i in (0,2,4)])
    x0,y0=round((case['x']-40)*scale),round((case['y']-40)*scale)
    area=pixels[y0:round((case['y']+220)*scale),x0:round((case['x']+200)*scale)]
    ys,xs=np.where(np.max(np.abs(area-rgb),axis=2)<10)
    return [(x0+int(xs.min()))/scale,(y0+int(ys.min()))/scale,(x0+int(xs.max())+1)/scale,(y0+int(ys.max())+1)/scale] if len(xs) else None
for case in cases:
    case['native']={'outline':bounds(case['color'],case),'shadow':bounds('00AA00',case)}
    assert case['native']['outline'] is not None
record={'referenceVersion':'16.0.20326','sourceSha256':sha256(source.read_bytes()).hexdigest(),
        'pdfSha256':sha256(pdf.read_bytes()).hexdigest(),'cases':cases}
(folder/'reference.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps(cases,indent=2))
