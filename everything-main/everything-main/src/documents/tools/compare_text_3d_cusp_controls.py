"""Compare generated cusp controls with the native reference using the existing flat-mask metric.

Run after text_3d_cusp_fixture.py; paths are a scratch capture directory.
The generated font has already been unregistered. No outline data is read from
installed fonts. A comparison report and paired review images are written.
"""
from pathlib import Path
import hashlib, json, sys
import numpy as np
from PIL import Image
import pypdfium2 as pdfium

output = Path(sys.argv[1]).resolve()
cases = json.loads((output/'cases.json').read_text())

def ink(a):
    return (a[:, :, 0] > 130) & (a[:, :, 1] < 100) & (a[:, :, 2] < 120)

def dilate(mask):
    p = np.pad(mask, 1)
    return np.logical_or.reduce([p[y:y+mask.shape[0], x:x+mask.shape[1]]
                                 for y in range(3) for x in range(3)])

records = []
with pdfium.PdfDocument(str(output/'native.pdf')) as pdf:
    assert len(pdf) == len(cases)
    for index in range(len(cases)):
        page = pdf[index]; bitmap = page.render(scale=4)
        native = np.array(bitmap.to_pil().convert('RGB'))
        bitmap.close(); page.close()
        app = np.array(Image.open(output/f'text3d-junction-page{index+1}.png').convert('RGB'))
        assert native.shape == app.shape
        n, a = ink(native), ink(app); ys, xs = np.where(n | a)
        box = tuple(map(int, (xs.min()-8, ys.min()-8, xs.max()+9, ys.max()+9)))
        x0, y0, x1, y1 = box; n, a = n[y0:y1, x0:x1], a[y0:y1, x0:x1]
        ne, ae = n.copy(), a.copy(); counts = []
        for radius in range(9):
            counts.append(int(np.count_nonzero(n & ~ae)+np.count_nonzero(a & ~ne)))
            ne, ae = dilate(ne), dilate(ae)
        records.append(dict(page=index+1, nativeInk=int(n.sum()), appInk=int(a.sum()),
                            unmatchedPixelsByRadius=counts))
        pair = Image.new('RGB', ((x1-x0)*2, y1-y0), 'white')
        pair.paste(Image.fromarray(native).crop(box), (0, 0))
        pair.paste(Image.fromarray(app).crop(box), (x1-x0, 0))
        pair.thumbnail((1000, 900)); pair.save(output/f'pair{index+1}.png')
names = ['control.docx', 'native.pdf', 'cases.json', 'outlines.json']
report = dict(pixelsPerPoint=4, method='Bidirectional red-ink masks with Chebyshev dilation, radii 0..8 pixels; no alignment or excluded regions.',
              hashes={n: hashlib.sha256((output/n).read_bytes()).hexdigest() for n in names}, records=records)
(output/'reference.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps([dict(page=r['page'], unmatchedAtOnePixel=r['unmatchedPixelsByRadius'][1]) for r in records]))
