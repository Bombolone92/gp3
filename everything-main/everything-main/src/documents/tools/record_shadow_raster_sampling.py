"""Record the native reference's exported shadow grid independently of browser rendering."""
from pathlib import Path
import hashlib, json
from native_shadow_images import native_images
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image

root=Path(__file__).resolve().parents[1]/'tests/fixtures/shadow-raster-sampling'
cases=json.loads((root/'cases.json').read_text())
pdf=PdfReader(root/'native.pdf')
assert len(pdf.pages)==len(cases)
pages=[]
for case,page in zip(cases,pdf.pages):
    assert page.extract_text().strip()==case['name']
    transforms=[]
    page.extract_text(visitor_operand_before=lambda op,args,cm,tm: transforms.append(list(cm)) if op==b'Do' else None)
    image=page.images[0].image
    assert image.mode=='RGBA'
    first=next(iter(page['/Resources']['/XObject'].values())).get_object()
    assert list(first['/SMask'].get_object()['/Matte'])==[0,0,0]
    alpha=image.getchannel('A')
    pages.append(dict(**case,shadowPixels=list(image.size),shadowMatrix=transforms[0],
        centerPremultipliedRgba=list(image.getpixel((image.width//2,image.height//2))),
        centerRow=[alpha.getpixel((x,image.height//2)) for x in range(image.width)],
        centerColumn=[alpha.getpixel((image.width//2,y)) for y in range(image.height)],
        alphaSha256=hashlib.sha256(alpha.tobytes()).hexdigest()))
hashes={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ['source.docx','native.pdf','cases.json']}
display=[]
rendered=pdfium.PdfDocument(root/'native.pdf')
for i in range(13,21):
    emf=root/f'shadow-color-{i}.emf'; png=root/f'shadow-color-{i}.png'
    image=Image.open(png).convert('RGB')
    assert image.size==(4232,1269)
    point=(2433,633)
    rgb=image.getpixel(point)
    assert all(image.getpixel((point[0]+x,point[1]+y))==rgb for x in range(-10,11) for y in range(-10,11))
    display.append(dict(page=i,png=png.name,emf=emf.name,pngSha256=hashlib.sha256(png.read_bytes()).hexdigest(),
        emfSha256=hashlib.sha256(emf.read_bytes()).hexdigest(),gdiPixel=list(point),gdiRgb=list(rgb),
        pdfPointPt=[324,136],pdfRgb=list(rendered[i-1].render(scale=2).to_pil().convert('RGB').getpixel((648,272))),
        nativeImages=native_images(emf)))
reference=dict(referenceVersion='16.0.20326',hashes=hashes,pages=pages,metafileComparisons=display,
    scope='PDF raw premultiplied bytes and PDFium composites are distinct from reference range metafiles rendered with Windows GDI+. Metafiles are not direct screen captures.')
(root/'reference.json').write_text(json.dumps(reference,indent=2)+'\n',encoding='utf-8')
for p in pages:
    spacing=.36+.12*p['blurPt']
    prediction=[round((p[k]+2*p['blurPt'])/spacing) for k in ['widthPt','heightPt']]
    print(p['name'], 'native',p['shadowPixels'],'simple-grid-prediction',prediction,'matrix',p['shadowMatrix'])
