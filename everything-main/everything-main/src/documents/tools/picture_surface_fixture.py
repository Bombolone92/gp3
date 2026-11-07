"""Original picture backing-fill, shadow, lighting and bevel reference controls.

One variable per page where possible. No template imagery is reused.
"""
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import sys
from lxml import etree as E
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/picture-surfaces'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
def sub(parent, ns, name, **attrs):
    return E.SubElement(parent, '{'+ns+'}'+name, attrs)

with ZipFile(ROOT / 'public/fixtures/inline-images.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
doc = E.fromstring(parts['word/document.xml'])
body = doc.find('{'+W+'}body')
drawing = deepcopy(doc.find('.//{'+W+'}drawing'))
sect = deepcopy(body.find('{'+W+'}sectPr'))
for node in list(body): body.remove(node)
cases = [
    ('baseline', {}),
    ('solid-backing', {'fill': True}),
    ('shaded-backing', {'fill': True, 'shade': True}),
    ('outer-shadow', {'shadow': True}),
    ('front-three-point', {'rig': 'threePt'}),
    ('front-two-point', {'rig': 'twoPt'}),
    ('two-point-rotation', {'rig': 'twoPt', 'rotation': True}),
    ('bevel-three-point', {'rig': 'threePt', 'bevel': True}),
    ('bevel-two-point', {'rig': 'twoPt', 'bevel': True}),
    ('bevel-two-point-rotation', {'rig': 'twoPt', 'bevel': True, 'rotation': True}),
    ('combined', {'fill': True, 'shade': True, 'shadow': True, 'rig': 'twoPt', 'rotation': True, 'bevel': True}),
]
backing_only = '--backing-only' in sys.argv
if backing_only:
    cases = cases[:3] + [
        ('translucent-backing', {'fill': True, 'shade': True, 'alpha': True}),
        ('ellipse-backing', {'fill': True, 'shade': True, 'ellipse': True}),
        ('crop-outset-backing', {'fill': True, 'shade': True, 'crop': True}),
        ('picture-opacity-backing', {'fill': True, 'shade': True, 'opacity': True}),
        ('front-three-point-backing', {'fill': True, 'shade': True, 'rig': 'threePt'}),
        ('grouped-backing', {'fill': True, 'shade': True, 'group': True}),
        ('outlined-backing', {'fill': True, 'shade': True, 'outline': True}),
    ]
# Transparent corner and half-alpha band distinguish backing from image tint.
im = Image.new('RGBA', (144, 144), (40, 130, 220, 255))
paint = ImageDraw.Draw(im)
paint.rectangle((0, 0, 47, 47), fill=(0, 0, 0, 0))
paint.rectangle((48, 0, 95, 143), fill=(220, 60, 40, 128))
paint.rectangle((96, 72, 143, 143), fill=(245, 190, 30, 255))
png = BytesIO(); im.save(png, format='PNG')
rels = E.fromstring(parts['word/_rels/document.xml.rels'])
sub(rels, REL, 'Relationship', Id='surfaceTexture', Type=R+'/image', Target='media/surface-texture.png')
parts['word/media/surface-texture.png'] = png.getvalue()
for index, (name, settings) in enumerate(cases):
    p = sub(body, W, 'p')
    if index:
        pr = sub(p, W, 'pPr'); sub(pr, W, 'pageBreakBefore')
    sub(sub(p, W, 'r'), W, 't').text = name
    p = sub(body, W, 'p'); d = deepcopy(drawing); sub(p, W, 'r').append(d)
    d.find('.//{'+WP+'}docPr').set('id', str(index+1))
    d.find('.//{'+WP+'}docPr').set('name', name)
    for ns, tag in [(WP, 'extent'), (A, 'ext')]:
        for node in d.iter('{'+ns+'}'+tag): node.attrib.update({'cx': '1828800', 'cy': '1828800'})
    d.find('.//{'+A+'}blip').set('{'+R+'}embed', 'surfaceTexture')
    if settings.get('opacity'): sub(d.find('.//{'+A+'}blip'), A, 'alphaModFix', amt='50000')
    if settings.get('crop'):
        fill = d.find('.//{'+PIC+'}blipFill')
        fill.insert(1, E.Element('{'+A+'}srcRect', l='-25000', r='0', t='0', b='0'))
    shape = d.find('.//{'+PIC+'}spPr')
    for node in list(shape):
        if node.tag not in ['{'+A+'}xfrm', '{'+A+'}prstGeom']: shape.remove(node)
    if settings.get('fill'):
        color = sub(sub(shape, A, 'solidFill'), A, 'srgbClr', val='FFFFFF')
        if settings.get('shade'): sub(color, A, 'shade', val='85000')
        if settings.get('alpha'): sub(color, A, 'alpha', val='50000')
    if settings.get('ellipse'): shape.find('{'+A+'}prstGeom').set('prst', 'ellipse')
    line = sub(shape, A, 'ln', **({'w': '12700'} if settings.get('outline') else {}))
    if settings.get('outline'): sub(sub(line, A, 'solidFill'), A, 'srgbClr', val='C020D0')
    else: sub(line, A, 'noFill')
    if settings.get('shadow'):
        shadow = sub(sub(shape, A, 'effectLst'), A, 'outerShdw', blurRad='55000', dist='18000', dir='5400000', algn='tl', rotWithShape='0')
        sub(sub(shadow, A, 'srgbClr', val='000000'), A, 'alpha', val='40000')
    if settings.get('rig'):
        scene = sub(shape, A, 'scene3d'); sub(scene, A, 'camera', prst='orthographicFront')
        light = sub(scene, A, 'lightRig', rig=settings['rig'], dir='t')
        if settings.get('rotation'): sub(light, A, 'rot', lat='0', lon='0', rev='7200000')
        solid = sub(shape, A, 'sp3d')
        if settings.get('bevel'): sub(solid, A, 'bevelT', w='25400', h='19050')
        sub(sub(solid, A, 'contourClr'), A, 'srgbClr', val='FFFFFF')
    if settings.get('group'):
        wpg = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'
        data = d.find('.//{'+A+'}graphicData'); pic = data[0]; data.remove(pic); data.set('uri', wpg)
        group = sub(data, wpg, 'wgp'); sub(group, wpg, 'cNvGrpSpPr')
        transform = sub(sub(group, wpg, 'grpSpPr'), A, 'xfrm')
        sub(transform, A, 'off', x='0', y='0'); sub(transform, A, 'ext', cx='1828800', cy='1828800')
        sub(transform, A, 'chOff', x='0', y='0'); sub(transform, A, 'chExt', cx='1828800', cy='1828800')
        group.append(pic)
body.append(sect)
parts['word/document.xml'] = E.tostring(doc)
parts['word/_rels/document.xml.rels'] = E.tostring(rels)
OUT.mkdir(parents=True, exist_ok=True)
with ZipFile(OUT / ('backing.docx' if backing_only else 'source.docx'), 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items(): z.writestr(name, data)
(OUT / ('backing-cases.json' if backing_only else 'cases.json')).write_text(json.dumps(cases, indent=2)+'\n', encoding='utf-8')
