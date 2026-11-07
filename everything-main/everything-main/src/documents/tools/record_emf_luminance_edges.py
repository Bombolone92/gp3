"""Record native raster dimensions and dark bounds; these are diagnostic, not a pass gate."""
from pathlib import Path
import hashlib, json, argparse
from pypdf import PdfReader
import pypdfium2 as pdfium

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--variant',choices=['base','inset-bounds','expanded-frame','overflow-frame'],default='base')
args=parser.parse_args()
folder=root/('tests/fixtures/emf-luminance-edges'+('' if args.variant=='base' else '-'+args.variant))
doc=pdfium.PdfDocument(folder/'native.pdf')
assert len(doc)==1
image=doc[0].render(scale=4/3).to_pil().convert('RGB')
bounds=[]
for row in range(4):
    for col in range(2):
        x0=round((60+260*col)*4/3)-2; y0=round((100+140*row)*4/3)-2
        points=[(x,y) for y in range(y0,y0+133) for x in range(x0,x0+135)
                if max(image.getpixel((x,y)))<80]
        bounds.append([min(x for x,y in points),min(y for x,y in points),
                       max(x for x,y in points),max(y for x,y in points)])
reader=PdfReader(folder/'native.pdf')
nativeImages=[]
boxes=[o.get_bounds() for o in doc[0].get_objects() if o.type==3]
for i, (entry, box) in enumerate(zip(reader.pages[0].images, boxes)):
    name=f'native-{i}.png'; entry.image.save(folder/name)
    left,bottom,right,top=box
    nativeImages.append(dict(file=name,sha256=hashlib.sha256((folder/name).read_bytes()).hexdigest(),
                             boxPx=[left*4/3,(792-top)*4/3,(right-left)*4/3,(top-bottom)*4/3]))
result=dict(sourceSha256=hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest(),
            pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),
            imageSizes=[list(i.image.size) for i in reader.pages[0].images],
            darkBounds96Dpi=bounds,nativeImages=nativeImages)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
