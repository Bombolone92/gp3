"""Record the reference's lossless gray controls independently of the canvas engine."""
from pathlib import Path
from hashlib import sha256
import json
import re
import numpy as np
import pypdfium2 as pdf
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1] / 'tests/fixtures'

def boundary(image):
    mask = np.asarray(image)[480:1352,240:1272,:3].min(axis=2) < 240
    points = []
    for y,row in enumerate(mask):
        x = np.flatnonzero(row)
        if len(x): points.extend([[60+x[0]/4,120+y/4],[60+(x[-1]+1)/4,120+y/4]])
    for x,col in enumerate(mask.T):
        y = np.flatnonzero(col)
        if len(y): points.extend([[60+x/4,120+y[0]/4],[60+x/4,120+(y[-1]+1)/4]])
    return points

def bands(image,axis):
    a = np.asarray(image)
    values = a[640:1196,756,:3].mean(axis=1) if axis == 'y' else a[916,480:1040,:3].mean(axis=1)
    base = 160 if axis == 'y' else 120
    result = {}
    for name,mask in [('dark',values < 110),('bright',(values > 160) & (values < 230))]:
        indices = np.flatnonzero(mask)
        runs = np.split(indices,np.flatnonzero(np.diff(indices)>1)+1)
        result[name] = [[base+int(s[0])/4,base+int(s[-1]+1)/4] for s in runs if len(s)>2]
        assert len(result[name]) == 1, (axis,name,result)
    return result

for folder in ['picture-3d-circle-outlines','picture-3d-texture-markers']:
    path = root / folder
    cases = json.loads((path/'cases.json').read_text())
    doc = pdf.PdfDocument(path/'native.pdf'); reader = PdfReader(path/'native.pdf')
    assert len(doc) == len(reader.pages) == len(cases) == 5
    for i,case in enumerate(cases):
        assert case['name'] in reader.pages[i].extract_text()
        case['pdfImageFilters'] = [str(o.get_object().get('/Filter')) for o in reader.pages[i]['/Resources'].get('/XObject',{}).values() if o.get_object().get('/Subtype') == '/Image']
        assert case['pdfImageFilters'] == ['/FlateDecode']
        image = doc[i].render(scale=4).to_pil().convert('RGB')
        case['boundaryPt'] = boundary(image)
        if folder.endswith('markers'): case['bandsPt'] = {axis:bands(image,axis) for axis in ['x','y']}
    data = {'referenceVersion':'16.0.20326','nativeRasterPixelsPerPoint':4,
            'sourceSha256':sha256((path/'control.docx').read_bytes()).hexdigest(),
            'pdfSha256':sha256((path/'native.pdf').read_bytes()).hexdigest(),'cases':cases}
    text = json.dumps(data,indent=2)
    # Keep each coordinate pair together for review without changing precision.
    text = re.sub(r'\[\n\s+([\d.]+),\n\s+([\d.]+)\n\s+\]',r'[\1, \2]',text)
    (path/'reference.json').write_text(text+'\n',encoding='utf-8')
