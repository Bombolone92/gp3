"""Record colored native text bounds for independent rotation controls."""
from pathlib import Path
from hashlib import sha256
import json
import numpy as np
import pypdfium2 as pdf

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/rotated-shape-text'
cases=json.loads((folder/'cases.json').read_text())
doc=pdf.PdfDocument(folder/'reference.pdf')
assert len(doc)==2
for page_index in range(len(doc)):
    page=doc[page_index];bitmap=page.render(scale=4)
    pixels=np.asarray(bitmap.to_pil().convert('RGB')).astype(int)
    for case in [c for c in cases if c['page']==page_index+1]:
        x,y=case['x'],case['y']
        region=[x-5,max(0,y-25),min(612,x+160),min(792,y+160 if case['index'] in [16,24] else y+90)]
        left,top,right,bottom=[round(v*4) for v in region]
        part=pixels[top:bottom,left:right];red,green,blue=part[:,:,0],part[:,:,1],part[:,:,2]
        ys,xs=np.where((blue-red>25)&(green-red>12)&(red<150))
        assert len(xs),case
        case['regionPt']=region
        case['nativeTextBoundsPt']=[(xs.min()+left)/4,(ys.min()+top)/4,(xs.max()+left+1)/4,(ys.max()+top+1)/4]
        case['nativeTextPixels']=len(xs)
    bitmap.close();page.close()
doc.close()
record={'referenceVersion':'16.0.20326','sourceSha256':sha256((folder/'control.docx').read_bytes()).hexdigest(),
    'pdfSha256':sha256((folder/'reference.pdf').read_bytes()).hexdigest(),'cases':cases}
(folder/'reference.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print([(c['index'],c['nativeTextBoundsPt']) for c in cases])
