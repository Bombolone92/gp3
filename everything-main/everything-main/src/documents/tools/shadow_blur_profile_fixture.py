"""Original opaque-square controls isolating outer-shadow blur from texture alpha."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
from copy import deepcopy
from io import BytesIO
import json
from lxml import etree as E
from PIL import Image

root = Path(__file__).resolve().parents[1]
out = root / 'tests/fixtures/shadow-blur-profile'
out.mkdir(exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

def sub(parent, ns, name, **attrs):
    return E.SubElement(parent, '{'+ns+'}'+name, attrs)

with ZipFile(root / 'tests/fixtures/picture-shadows/source.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
doc = E.fromstring(parts['word/document.xml'])
body = doc.find('{'+W+'}body')
drawing = deepcopy(doc.findall('.//{'+W+'}drawing')[1])
section = deepcopy(body.find('{'+W+'}sectPr'))
section.find('{'+W+'}pgSz').attrib.update({'{'+W+'}w':'12240', '{'+W+'}h':'10080'})
rid = drawing.find('.//{'+A+'}blip').get('{'+R+'}embed')
relationships = E.fromstring(parts['word/_rels/document.xml.rels'])
target = next(n.get('Target') for n in relationships if n.get('Id') == rid)
assert target.startswith('media/') and target.endswith('.png')
png = BytesIO()
Image.new('RGBA', (32, 32), (0, 0, 0, 255)).save(png, format='PNG')
parts['word/'+target] = png.getvalue()
for node in list(body):
    body.remove(node)
cases = [dict(name=f'square-{size}-blur-{blur}', sizePt=size, blurPt=blur)
         for size in (72, 144) for blur in (0, 6, 12, 24, 36, 48)]
for i, case in enumerate(cases):
    p = sub(body, W, 'p')
    if i:
        sub(sub(p, W, 'pPr'), W, 'pageBreakBefore')
    sub(sub(p, W, 'r'), W, 't').text = case['name']
    d = deepcopy(drawing)
    sub(sub(body, W, 'p'), W, 'r').append(d)
    pr = d.find('.//{'+WP+'}docPr')
    pr.set('id', str(i+1)); pr.set('name', case['name'])
    extent = str(case['sizePt']*12700)
    d.find('.//{'+WP+'}extent').attrib.update(dict(cx=extent, cy=extent))
    d.find('.//{'+A+'}xfrm/{'+A+'}ext').attrib.update(dict(cx=extent, cy=extent))
    effects = d.find('.//{'+PIC+'}spPr/{'+A+'}effectLst')
    for node in list(effects):
        effects.remove(node)
    shadow = sub(effects, A, 'outerShdw', blurRad=str(case['blurPt']*12700),
                 dist=str(216*12700), dir='0', algn='tl', rotWithShape='0')
    sub(sub(shadow, A, 'srgbClr', val='000000'), A, 'alpha', val='100000')
body.append(section)
parts['word/document.xml'] = E.tostring(doc)
with ZipFile(out / 'source.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items():
        info = ZipInfo(name, (2026, 9, 25, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
        z.writestr(info, data)
(out / 'cases.json').write_text(json.dumps(cases, indent=2)+'\n', encoding='utf-8')
