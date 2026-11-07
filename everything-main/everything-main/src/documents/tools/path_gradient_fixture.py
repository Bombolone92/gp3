"""Original circular path gradient geometry controls; no corpus content is copied."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
import json
from lxml import etree as E
from canvas_group_fixture import tag, add

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/path-gradients'
OUT.mkdir(exist_ok=True)
CASES = [
    dict(name=f'circle-{name}-{alpha}-{count}', rect=rect, alpha=alpha, count=count)
    for name, rect in [('default', None), ('center', [50000]*4),
                       ('top-right', [100000,0,0,100000]),
                       ('bottom-left', [0,100000,100000,0]),
                       ('area', [25000]*4), ('outside', [-50000,50000,150000,50000])]
    for alpha in [100000,20000]
    for count in [3,2]
]
with ZipFile(ROOT / 'public/fixtures/shape-theme.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
root = E.fromstring(parts['word/document.xml'])
body = root.find(tag('w:body'))
template = deepcopy(root.find('.//' + tag('wp:anchor')))
section = deepcopy(body.find(tag('w:sectPr')))
body.clear()
add(add(add(body, 'w:p'), 'w:r'), 'w:t', text='Independent circular path gradient controls')
for i, case in enumerate(CASES):
    if i == 12: add(add(add(body, 'w:p'), 'w:r'), 'w:br', **{'w:type':'page'})
    frame = deepcopy(template)
    frame.set('relativeHeight', str(251658240 + i * 1024))
    x, y, width, height = 60 + 260 * (i % 2), 75 + 105 * ((i % 12) // 2), 210, 65
    case.update(x=x, y=y, width=width, height=height, page=i//12)
    for axis, value in [('H', x), ('V', y)]:
        frame.find(tag('wp:position' + axis) + '/' + tag('wp:posOffset')).text = str(value * 12700)
    extent = frame.find(tag('wp:extent'))
    extent.set('cx', str(width * 12700)); extent.set('cy', str(height * 12700))
    pr = frame.find(tag('wp:docPr'))
    pr.set('id', str(i + 1)); pr.set('name', case['name'])
    shape = frame.find('.//' + tag('wps:wsp'))
    props = shape.find(tag('wps:spPr'))
    for node in list(props):
        if E.QName(node).localname not in ['xfrm', 'prstGeom']: props.remove(node)
    ext = props.find(tag('a:xfrm') + '/' + tag('a:ext'))
    ext.set('cx', str(width * 12700)); ext.set('cy', str(height * 12700))
    props.find(tag('a:prstGeom')).set('prst', 'rect')
    gradient = add(props, 'a:gradFill', rotWithShape='1', flip='none')
    stops = add(gradient, 'a:gsLst')
    for position, color in [(0, 'FF0000'), (50000, '00FF00'), (100000, '0000FF')]:
        if position == 50000 and case['count'] == 2: continue
        color_node = add(add(stops, 'a:gs', pos=position), 'a:srgbClr', val=color)
        if position == 100000 and case['alpha'] != 100000: add(color_node, 'a:alpha', val=case['alpha'])
    path = add(gradient, 'a:path', path='circle')
    if case['rect'] is not None: add(path, 'a:fillToRect', **dict(zip(['l','t','r','b'],case['rect'])))
    add(gradient, 'a:tileRect')
    add(add(props, 'a:ln'), 'a:noFill')
    for name in ['style', 'txbx']:
        node = shape.find(tag('wps:' + name))
        if node is not None: shape.remove(node)
    add(add(add(body, 'w:p'), 'w:r'), 'w:drawing').append(frame)
body.append(section)
parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items(): z.writestr(name, data)
(OUT / 'cases.json').write_text(json.dumps(CASES, indent=2) + '\n')
