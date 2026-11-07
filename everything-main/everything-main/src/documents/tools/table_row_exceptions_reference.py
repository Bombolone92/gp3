"""Record native reference color extents and disconnected border bands at 96 dpi."""
from pathlib import Path
import hashlib, json
import numpy as np
import pypdfium2 as pdf

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/table-row-exceptions'
COLORS = ['D02020','208020','2040D0','9020A0','008090','D07000','B08000',
          'E8B0B0','B0E8B0','B0D0E8','E8D0B0']

def bands(projection):
    positions=np.flatnonzero(projection)
    if not len(positions): return []
    groups=np.split(positions,np.flatnonzero(np.diff(positions)>1)+1)
    return [[float(g[0])*.75,float(g[-1]+1)*.75] for g in groups]

def measure(image, colors=COLORS):
    a=np.asarray(image.convert('RGB')).astype(float)
    result={}
    for color in colors:
        c=np.array([int(color[i:i+2],16) for i in (0,2,4)])
        channel=np.argmin(c)
        alpha=(255-a[:,:,channel])/(255-c[channel])
        expected=255-alpha[:,:,None]*(255-c)
        mask=(alpha>.25)&(np.max(np.abs(a-expected),axis=2)<3)
        if mask.any():
            result[color]=dict(x=bands(mask.any(axis=0)),y=bands(mask.any(axis=1)))
    return result

if __name__=='__main__':
    document=pdf.PdfDocument(ROOT/'controls-native.pdf')
    pages=[measure(page.render(scale=4/3).to_pil(), COLORS[7:] if 11 <= i <= 13 else COLORS[:7]) for i,page in enumerate(document)]
    assert len(pages)==18
    sha=lambda name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
    (ROOT/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',
        sourceSha256=sha('controls.docx'),pdfSha256=sha('controls-native.pdf'),pages=pages),indent=2)+'\n')
    print('Recorded 18 native pages including disconnected row-border bands.')
