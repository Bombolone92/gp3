"""Original matched left-camera ellipse controls; no corpus artwork."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/picture-3d-left-outlines'
folder.mkdir(exist_ok=True)
with ZipFile(root / 'tests/fixtures/picture-3d-textures/control.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
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
cases = []
for depth in [20, 0]:
    for label, width in [('absent', None), ('no-fill', 2), ('thin', .75), ('medium', 2), ('wide', 8)]:
        name = f'depth-{depth}-{label}'
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
        shape.find(A + 'sp3d').set('extrusionH', str(round(depth * 12700)))
        if width is not None:
            line = E.Element(A + 'ln', w=str(round(width * 12700)))
            if label == 'no-fill':
                E.SubElement(line, A + 'noFill')
            else:
                E.SubElement(E.SubElement(line, A + 'solidFill'), A + 'srgbClr', val='202060')
            shape.insert(list(shape).index(shape.find(A + 'scene3d')), line)
        paragraph.find('.//' + WP + 'docPr').attrib.update({'id': str(len(cases) + 1), 'name': name})
        body.append(paragraph)
        cases.append({'name': name, 'widthPt': 144, 'heightPt': 108, 'extrusionPt': depth,
                      'outlinePt': width, 'noFill': label == 'no-fill', 'camera': 'perspectiveLeft',
                      'xPt': 100, 'yPt': 140})
body.append(section)
parts['word/document.xml'] = E.tostring(doc, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(folder / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for n, data in parts.items():
        z.writestr(n, data)
(folder / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')
