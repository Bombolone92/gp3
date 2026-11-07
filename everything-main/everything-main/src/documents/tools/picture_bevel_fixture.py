"""Independent, enlarged top-bevel probes using original picture textures."""
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import sys
from lxml import etree as E
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/picture-bevel'
OUT.mkdir(exist_ok=True)
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
REL = '{http://schemas.openxmlformats.org/package/2006/relationships}'
cases = [
    dict(name='baseline', bevel=None),
    dict(name='default', bevel={}),
    dict(name='explicit-default', bevel=dict(w=6, h=6, prst='circle')),
    dict(name='small-rotated', bevel=dict(w=2, h=1.5), rig='twoPt', rotation=120),
    dict(name='wide', bevel=dict(w=18, h=6)),
    dict(name='tall', bevel=dict(w=6, h=18)),
    dict(name='right-wide', bevel=dict(w=18, h=6), camera='perspectiveRight'),
    dict(name='left-tall', bevel=dict(w=6, h=18), camera='perspectiveLeft'),
    dict(name='extruded', bevel=dict(w=6, h=6), camera='perspectiveRight', depth=20),
    dict(name='ellipse-front', bevel=dict(w=6, h=6), geometry='ellipse'),
    dict(name='ellipse-right', bevel=dict(w=6, h=6), geometry='ellipse', camera='perspectiveRight'),
    dict(name='zero-height', bevel=dict(w=6, h=0)),
    dict(name='zero-width', bevel=dict(w=0, h=6)),
    dict(name='oversize', bevel=dict(w=80, h=6)),
    dict(name='gradient-front', bevel=dict(w=18, h=6), gradient=True),
    dict(name='gradient-right', bevel=dict(w=18, h=6), gradient=True, camera='perspectiveRight'),
    dict(name='angle-wide', bevel=dict(w=18, h=6, prst='angle')),
    dict(name='outlined', bevel=dict(w=6, h=6), outline=4),
    dict(name='contoured', bevel=dict(w=6, h=6), contour=4, camera='perspectiveRight'),
    dict(name='zero-width-right', bevel=dict(w=0, h=6), camera='perspectiveRight'),
    dict(name='zero-height-right', bevel=dict(w=6, h=0), camera='perspectiveRight'),
    dict(name='oversize-right', bevel=dict(w=80, h=6), camera='perspectiveRight', gradient=True),
    dict(name='baseline-right', bevel=None, camera='perspectiveRight'),
]
lighting_only = '--lighting-only' in sys.argv
density_only = '--density-only' in sys.argv
if lighting_only:
    cases = [dict(name=f'{rig}-{rotation}', bevel=dict(w=12, h=12, prst='angle'), rig=rig, **({} if rotation is None else dict(rotation=rotation))) for rig in ['threePt', 'twoPt'] for rotation in [None, 0, 120, 270]]
if density_only:
    cases = [dict(name=f'circle-{w}-{h}', bevel=dict(w=w, h=h)) for w, h in [(2.5,2.5),(3.7,3.7),(4.4,4.4),(12,12),(24,24),(3,6),(6,3)]]
    cases += [dict(name=f'rotated-{w}', bevel=dict(w=w, h=w*.75), rig='twoPt', rotation=120) for w in [2.5,4,4.4]]
    cases += [dict(name=f'threshold-{w}', bevel=dict(w=w, h=12)) for w in [3.3,3.5]]
stem = 'lighting' if lighting_only else 'density' if density_only else 'source'
with ZipFile(ROOT / 'public/fixtures/picture-3d.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
root = E.fromstring(parts['word/document.xml']); body = root.find(W + 'body')
picture = deepcopy(body.find('.//' + W + 'drawing')); section = deepcopy(body.find(W + 'sectPr'))
for item in list(body): body.remove(item)
# Coordinate-coded image reveals whether the bevel stretches the texture.
im = Image.new('RGB', (288, 216))
im.putdata([(round(x * 255 / 287), round(y * 255 / 215), 80) for y in range(216) for x in range(288)])
data = BytesIO(); im.save(data, format='PNG'); parts['word/media/bevel-gradient.png'] = data.getvalue()
rels = E.fromstring(parts['word/_rels/document.xml.rels'])
E.SubElement(rels, REL + 'Relationship', Id='bevelGradient', Type=R[1:-1] + '/image', Target='media/bevel-gradient.png')
parts['word/_rels/document.xml.rels'] = E.tostring(rels)
for i, case in enumerate(cases):
    p = E.SubElement(body, W + 'p')
    if i: E.SubElement(E.SubElement(p, W + 'pPr'), W + 'pageBreakBefore')
    E.SubElement(E.SubElement(p, W + 'r'), W + 't').text = case['name']
    d = deepcopy(picture); E.SubElement(E.SubElement(body, W + 'p'), W + 'r').append(d)
    d.find('.//' + WP + 'docPr').set('id', str(i + 1))
    if case.get('gradient'): d.find('.//' + A + 'blip').set(R + 'embed', 'bevelGradient')
    d.find('.//' + A + 'prstGeom').set('prst', case.get('geometry', 'rect'))
    d.find('.//' + A + 'camera').set('prst', case.get('camera', 'orthographicFront'))
    light = d.find('.//' + A + 'lightRig'); light.set('rig', case.get('rig', 'threePt'))
    if 'rotation' in case: E.SubElement(light, A + 'rot', lat='0', lon='0', rev=str(case['rotation'] * 60000))
    solid = d.find('.//' + A + 'sp3d'); solid.set('extrusionH', str(round(case.get('depth', 0) * 12700)))
    solid.set('contourW', str(round(case.get('contour', 0) * 12700)))
    if case['bevel'] is not None:
        E.SubElement(solid, A + 'bevelT', **{k: str(round(v * 12700)) if k in ['w', 'h'] else v for k, v in case['bevel'].items()})
    if case.get('contour'): E.SubElement(E.SubElement(solid, A + 'contourClr'), A + 'srgbClr', val='202060')
    if case.get('outline'):
        shape = solid.getparent(); line = E.Element(A + 'ln', w=str(case['outline'] * 12700))
        E.SubElement(E.SubElement(line, A + 'solidFill'), A + 'srgbClr', val='C020D0')
        shape.insert(list(shape).index(d.find('.//' + A + 'scene3d')), line)
body.append(section); parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(OUT / f'{stem}.docx', 'w', ZIP_DEFLATED) as z:
    for n, data in parts.items(): z.writestr(n, data)
(OUT / ('cases.json' if stem == 'source' else f'{stem}-cases.json')).write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')
