"""Native reference samples for enlarged, independently authored bevels."""
from pathlib import Path
import hashlib
import json
import re
import sys
import pypdfium2 as pdf
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/picture-bevel'
stem = 'lighting' if '--lighting-only' in sys.argv else 'density' if '--density-only' in sys.argv else 'source'
cases = json.loads((OUT / ('cases.json' if stem == 'source' else f'{stem}-cases.json')).read_text())
pdf_name = 'native.pdf' if stem == 'source' else f'{stem}.pdf'
doc = pdf.PdfDocument(OUT / pdf_name)
raw = PdfReader(OUT / pdf_name)
assert len(doc) == len(cases)
pages = []
for i, case in enumerate(cases):
    page = doc[i]
    assert page.get_textpage().get_text_range().strip() == case['name']
    im = page.render(scale=4).to_pil().convert('RGB')
    samples = []
    for edge in ['top', 'bottom', 'left', 'right']:
        for inset in [.5, 1, 2, 3, 4, 6, 9, 12, 15, 17, 18, 20, 24, 30, 40, 50]:
            x, y = {'top': (136, 140 + inset), 'bottom': (136, 248 - inset), 'left': (100 + inset, 167), 'right': (244 - inset, 167)}[edge]
            sample = dict(edge=edge, inset=inset, x=x, y=y, rgb=im.getpixel((round(x*4), round(y*4))))
            if stem == 'source':
                # Native colors around the same CSS-pixel center. A local
                # segment of this palette admits subpixel coverage mixtures.
                # Its 1.25pt radius matches the independent silhouette bound;
                # sharp material/coverage transitions are geometry checks.
                cx = round((round(x*4/3)+.5)*3-.5); cy = round((round(y*4/3)+.5)*3-.5)
                sample['palette'] = sorted({im.getpixel((cx+dx,cy+dy)) for dx in range(-5,6) for dy in range(-5,6)})
                sample['outlineTransition'] = bool(case.get('outline') and abs(inset-case['outline']/2) < .75)
                sample['contourTransition'] = bool(case.get('contour') and (32,32,96) in sample['palette'] and any(max(abs(v[k]-[32,32,96][k]) for k in range(3)) > 12 for v in sample['palette']))
            samples.append(sample)
    record = dict(name=case['name'], samples=samples)
    image_objects = [v.get_object() for v in raw.pages[i]['/Resources']['/XObject'].values() if v.get_object().get('/Subtype') == '/Image']
    assert len(image_objects) == 1
    record['imageFilter'] = str(image_objects[0]['/Filter'])
    assert record['imageFilter'] in ['/FlateDecode', '/DCTDecode']
    if stem == 'source':
        record['outline'] = []
        for y in range(110*4,275*4):
            xs = [x for x in range(75*4,275*4) if min(im.getpixel((x,y))) < 240]
            if xs: record['outline'].extend([[min(xs)/4,y/4],[(max(xs)+1)/4,y/4]])
        for x in range(75*4,275*4):
            ys = [y for y in range(110*4,275*4) if min(im.getpixel((x,y))) < 240]
            if ys: record['outline'].extend([[x/4,min(ys)/4],[x/4,(max(ys)+1)/4]])
        record['rows'] = []
        for y in [130,140,145,155,167,180,194,208,221,235,243,248,258]:
            xs = [x for x in range(75*4,275*4) if min(im.getpixel((x,y*4))) < 240]
            record['rows'].append(dict(y=y, interval=[min(xs)/4,(max(xs)+1)/4] if xs else None))
        record['columns'] = []
        for x in [90,100,110,125,136,155,172,190,208,225,238,244,254]:
            ys = [y for y in range(110*4,275*4) if min(im.getpixel((x*4,y))) < 240]
            record['columns'].append(dict(x=x, interval=[min(ys)/4,(max(ys)+1)/4] if ys else None))
    if stem == 'lighting':
        record['slopes'] = [dict(x=x, y=y, normal=n, color=color, rgb=im.getpixel((x*4,y*4))) for x,y,n,color in [(136,146,[0,-1,1],[240,40,30]),(136,242,[0,1,1],[40,170,70]),(106,167,[-1,0,1],[240,40,30]),(238,167,[1,0,1],[30,80,210])]]
    if case.get('bevel') is not None and case.get('camera', 'orthographicFront') == 'orthographicFront' and not case.get('gradient') and not case.get('outline'):
        raster = raw.pages[i].images[0].image
        transforms = re.findall(r'([0-9.]+) 0 0 ([0-9.]+) ([0-9.]+) ([0-9.]+) cm', raw.pages[i].get_contents().get_data().decode('latin1'))
        sx, sy, x, y = map(float, transforms[-1]); top = 792 - y - sy
        width = case['bevel'].get('w', 6)
        record['rawTop'] = dict(imageFilter=record['imageFilter'], pixelPitch=sy/raster.height, top=top, leadingAlpha=raster.getpixel((300,0))[3], samples=[])
        for row in range(raster.height):
            inset = top + (row+.5)*sy/raster.height - 140
            rgba = raster.getpixel((300,row))
            if .4 < inset < min(width-.2, 30) and rgba[3] == 255:
                record['rawTop']['samples'].append(dict(inset=inset, rgb=rgba[:3]))
    pages.append(record)
result = dict(sourceSha256=hashlib.sha256((OUT / f'{stem}.docx').read_bytes()).hexdigest(), pdfSha256=hashlib.sha256((OUT / pdf_name).read_bytes()).hexdigest(), referenceVersion='16.0.20326', dpi=288, pages=pages)
(OUT / ('reference.json' if stem == 'source' else f'{stem}-reference.json')).write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
print(f'Recorded {len(pages)} pages and {sum(len(p["samples"]) for p in pages)} independent samples')
