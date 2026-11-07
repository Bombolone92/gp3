"""Record independent reference color bounds, including absent zero-extent ink."""
from pathlib import Path
from hashlib import sha256
import json
import sys
import numpy as np
import pypdfium2 as pdf

root=Path(__file__).resolve().parents[1]
fixture=sys.argv[1] if len(sys.argv)>1 else 'flat-custom-shapes'
assert fixture in ['flat-custom-shapes','flat-custom-standalone']
folder=root/'tests/fixtures'/fixture
source=root/'public/fixtures'/(fixture+'.docx')
reference=folder/'reference.pdf'
cases=json.loads((folder/'cases.json').read_text())
doc=pdf.PdfDocument(reference)
assert len(doc)==1
page=doc[0]; bitmap=page.render(scale=4)
pixels=np.asarray(bitmap.to_pil().convert('RGB')).astype(int)
for case in cases:
    rgb=np.array([int(case['color'][i:i+2],16) for i in (0,2,4)])
    ys,xs=np.where(np.max(np.abs(pixels-rgb),axis=2)<=2)
    case['nativeInkPixels']=len(xs)
    case['nativeInkBoundsPt']=([int(xs.min())/4,int(ys.min())/4,
        (int(xs.max())+1)/4,(int(ys.max())+1)/4] if len(xs) else None)
bitmap.close(); page.close(); doc.close()
record=dict(referenceVersion='16.0.20326',sourceSha256=sha256(source.read_bytes()).hexdigest(),
    pdfSha256=sha256(reference.read_bytes()).hexdigest(),scale=4,colorTolerance=2,cases=cases)
(folder/'reference.json').write_text(json.dumps(record,indent=2)+'\n')
print([(c['name'],c['nativeInkBoundsPt']) for c in cases])
