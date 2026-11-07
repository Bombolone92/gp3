"""Original light-rig controls derived from our independently authored 3D picture.

Both camera sides distinguish the sense of revolution from a front-only test.
"""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/picture-lighting'
OUT.mkdir(exist_ok=True)
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
with ZipFile(ROOT / 'public/fixtures/picture-3d.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
root = E.fromstring(parts['word/document.xml'])
body = root.find(W + 'body')
picture = deepcopy(body.find('.//' + W + 'drawing'))
section = deepcopy(body.find(W + 'sectPr'))
for item in list(body): body.remove(item)
cases, lights = [], []
for rig in ['threePt', 'twoPt']:
    for rotation in [None, 120, 270]:
        for camera in ['perspectiveRight', 'perspectiveLeft']:
            name = f'{rig}-{rotation or 0}-{camera}'
            cases.append([name, camera, 20, 0, 'rect', 144, 108])
            lights.append({'rig': rig, 'rotation': rotation, 'direction': 't'})
# Explicit rotation must override dir, including an explicit zero revolution.
for rotation in [0, 120]:
    cases.append([f'override-bottom-{rotation}', 'perspectiveRight', 20, 0, 'rect', 144, 108])
    lights.append({'rig': 'twoPt', 'rotation': rotation, 'direction': 'b'})
for i, (case, light) in enumerate(zip(cases, lights)):
    p = E.SubElement(body, W + 'p')
    if i: E.SubElement(E.SubElement(p, W + 'pPr'), W + 'pageBreakBefore')
    E.SubElement(E.SubElement(p, W + 'r'), W + 't').text = case[0]
    d = deepcopy(picture)
    E.SubElement(E.SubElement(body, W + 'p'), W + 'r').append(d)
    d.find('.//' + WP + 'docPr').set('id', str(i + 1))
    d.find('.//' + A + 'camera').set('prst', case[1])
    solid = d.find('.//' + A + 'sp3d'); solid.set('extrusionH', '254000')
    rig = d.find('.//' + A + 'lightRig'); rig.set('rig', light['rig']); rig.set('dir', light['direction'])
    if light['rotation'] is not None:
        E.SubElement(rig, A + 'rot', lat='0', lon='0', rev=str(light['rotation'] * 60000))
body.append(section)
parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(ROOT / 'public/fixtures/picture-lighting.docx', 'w', ZIP_DEFLATED) as z:
    for n, data in parts.items(): z.writestr(n, data)
(OUT / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')
(OUT / 'lights.json').write_text(json.dumps(lights, indent=2) + '\n', encoding='utf-8')
