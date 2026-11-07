"""Original fine-detail textures isolate minification in 3D pictures."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from io import BytesIO
from lxml import etree as E
from PIL import Image
import json
import numpy as np

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/picture-3d-sampling'
folder.mkdir(exist_ok=True)
with ZipFile(root / 'tests/fixtures/picture-3d-textures/control.docx') as z:
    parts = {name: z.read(name) for name in z.namelist()}
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
      'pic': 'http://schemas.openxmlformats.org/drawingml/2006/picture'}
W, A, WP, P = [f'{{{ns[n]}}}' for n in ['w', 'a', 'wp', 'pic']]
doc = E.fromstring(parts['word/document.xml'])
body = doc.find(W + 'body')
section = deepcopy(body.find(W + 'sectPr'))
picture = next(deepcopy(p) for p in body if p.find('.//' + WP + 'docPr') is not None
               and p.find('.//' + WP + 'docPr').get('name') == 'gray-left-ellipse')
for p in list(body):
    body.remove(p)
rels = E.fromstring(parts['word/_rels/document.xml.rels'])
R = '{http://schemas.openxmlformats.org/package/2006/relationships}'
embed = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed'
y, x = np.indices((2048, 2048))
textures = {'checker': 64 + 128 * ((x + y) % 2),
            'diagonal': 64 + 128 * ((x + 2 * y) % 8 < 4),
            'coarse': 64 + 128 * ((x // 64 + y // 64) % 2)}
for name, pixels in textures.items():
    stream = BytesIO()
    Image.fromarray(pixels.astype('uint8')).convert('RGB').save(stream, format='PNG')
    parts['word/media/' + name + '.png'] = stream.getvalue()
    E.SubElement(rels, R + 'Relationship', Id='sampling-' + name,
                 Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
                 Target='media/' + name + '.png')
cases = []
for texture in textures:
    for camera, geometry, depth in [('orthographicFront', 'rect', 0), ('perspectiveLeft', 'ellipse', 20)]:
        name = texture + '-' + camera
        if cases:
            E.SubElement(E.SubElement(E.SubElement(body, W + 'p'), W + 'r'), W + 'br').set(W + 'type', 'page')
        caption = E.SubElement(E.SubElement(body, W + 'p'), W + 'r')
        rp = E.SubElement(caption, W + 'rPr')
        E.SubElement(rp, W + 'rFonts').attrib.update({W + 'ascii': 'Arial', W + 'hAnsi': 'Arial'})
        E.SubElement(rp, W + 'sz').set(W + 'val', '20')
        E.SubElement(caption, W + 't').text = name
        paragraph = deepcopy(picture)
        shape = paragraph.find('.//' + P + 'spPr')
        shape.remove(shape.find(A + 'ln'))
        shape.find(A + 'prstGeom').set('prst', geometry)
        shape.find(A + 'scene3d/' + A + 'camera').set('prst', camera)
        shape.find(A + 'sp3d').set('extrusionH', str(depth * 12700))
        paragraph.find('.//' + A + 'blip').set(embed, 'sampling-' + texture)
        paragraph.find('.//' + WP + 'docPr').attrib.update({'id': str(len(cases) + 1), 'name': name})
        body.append(paragraph)
        cases.append({'name': name, 'texture': texture, 'camera': camera, 'geometry': geometry,
                      'widthPt': 144, 'heightPt': 108, 'extrusionPt': depth, 'xPt': 100, 'yPt': 140})
body.append(section)
parts['word/document.xml'] = E.tostring(doc, xml_declaration=True, encoding='UTF-8', standalone=True)
parts['word/_rels/document.xml.rels'] = E.tostring(rels, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(folder / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items():
        z.writestr(name, data)
(folder / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
