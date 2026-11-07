"""Record the reference pixels and sampled PDF functions independently of the engine."""
from pathlib import Path
from hashlib import sha256
import json
from bisect import bisect_right
import pypdfium2 as pdfium
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]

def pdf_function(function, t):
    """Evaluate the native PDF function, not an application gradient formula."""
    kind = int(function['/FunctionType'])
    if kind == 0:
        data = function.get_data(); count = int(function['/Size'][0])
        lo_domain,hi_domain = map(float,function['/Domain'])
        lo_encode,hi_encode = map(float,function['/Encode'])
        at = min(count-1,max(0,lo_encode+(hi_encode-lo_encode)*(t-lo_domain)/(hi_domain-lo_domain)))
        lo = int(at); hi = min(count-1,lo+1)
        return [(data[lo*3+c]*(1-(at-lo))+data[hi*3+c]*(at-lo))/255 for c in range(3)]
    if kind == 2:
        a,b = function['/C0'],function['/C1']; weight = t**float(function['/N'])
        return [float(x)*(1-weight)+float(y)*weight for x,y in zip(a,b)]
    assert kind == 3
    bounds = [float(function['/Domain'][0]), *map(float,function['/Bounds']),float(function['/Domain'][1])]
    index = min(len(bounds)-2,max(0,bisect_right(bounds,t)-1))
    a,b = map(float,function['/Encode'][index*2:index*2+2])
    u = a+(b-a)*(t-bounds[index])/(bounds[index+1]-bounds[index])
    return pdf_function(function['/Functions'][index].get_object(),u)

for name in ['gradient-colors', 'gradient-color-edges']:
    folder = root/'tests/fixtures'/name
    doc = pdfium.PdfDocument(folder/'native.pdf')
    assert len(doc) == 1
    image = doc[0].render(scale=4).to_pil().convert('RGB')
    samples = []
    for i in range(12):
        x, y = 60+260*(i%2), 75+105*(i//2)
        for fraction in [.025, .1, .2, .3, .4, .5, .6, .7, .8, .9, .975]:
            for dy in [.2, .5, .8]:
                px, py = int((x+210*fraction)*4), int((y+65*dy)*4)
                samples.append(dict(case=i,x=(px+.5)/4,y=(py+.5)/4,color=list(image.getpixel((px,py)))))
    functions = []
    page = PdfReader(folder/'native.pdf').pages[0]
    for index, pattern in enumerate(page['/Resources']['/Pattern'].values()):
        shading = pattern.get_object()['/Shading']
        function = shading['/Function']
        item = dict(type=int(function['/FunctionType']))
        if item['type'] == 0:
            data = function.get_data()
            assert len(data) == 512*3
            # The reference's first half is the preceding mirrored gradient tile.
            item['colors'] = [list(data[i:i+3]) for i in range(256*3,len(data),3)]
        if name == 'gradient-colors' or index < 8:
            # PDFium's axial-raster lookup further quantizes both sampled and
            # stitched shadings. Assert the native reference's actual exported function for
            # opaque controls; retain raster colors for transparent composites.
            x0,y0,x1,y1 = map(float, shading['/Coords'])
            for sample in samples:
                if sample['case'] != index: continue
                t = ((sample['x']-x0)*(x1-x0)+(792-sample['y']-y0)*(y1-y0))/((x1-x0)**2+(y1-y0)**2)
                sample['rasterColor'] = sample['color']
                sample['color'] = [round(c*255) for c in pdf_function(function,t)]
        functions.append(item)
    reference = dict(sourceSha256=sha256((folder/'control.docx').read_bytes()).hexdigest(),
                     pdfSha256=sha256((folder/'native.pdf').read_bytes()).hexdigest(),
                     samples=samples, functions=functions)
    (folder/'reference.json').write_text(json.dumps(reference,indent=2)+'\n',encoding='utf-8')
