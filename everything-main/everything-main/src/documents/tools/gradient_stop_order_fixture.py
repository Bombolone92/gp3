"""Original gradient geometry controls; no corpus content is copied."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
import json
from lxml import etree as E
from canvas_group_fixture import tag, add

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/gradient-stop-order'
OUT.mkdir(exist_ok=True)
from itertools import permutations
base=[(0,'FF0000'),(50000,'00FF00'),(100000,'0000FF')]
CASES=[dict(name='order-'+''.join(map(str,order)),angle=0,scaled=False,stops=[base[i] for i in order]) for order in permutations(range(3))]
CASES += [dict(name=name,angle=0,scaled=False,stops=stops) for name,stops in [
 ('ties-ordered',[(0,'FF0000'),(50000,'00FF00'),(50000,'0000FF'),(100000,'FFFF00')]),
 ('ties-unordered',[(100000,'FFFF00'),(50000,'00FF00'),(0,'FF0000'),(50000,'0000FF')]),
 ('ties-reversed',[(100000,'FFFF00'),(50000,'0000FF'),(0,'FF0000'),(50000,'00FF00')]),
 ('endpoint-ties',[(100000,'0000FF'),(0,'FFFF00'),(100000,'FF00FF'),(0,'FF0000')])]]
with ZipFile(ROOT / 'public/fixtures/shape-theme.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
root = E.fromstring(parts['word/document.xml'])
body = root.find(tag('w:body'))
template = deepcopy(root.find('.//' + tag('wp:anchor')))
section = deepcopy(body.find(tag('w:sectPr')))
body.clear()
add(add(add(body, 'w:p'), 'w:r'), 'w:t', text='Independent gradient stop order controls')
for i, case in enumerate(CASES):
    frame = deepcopy(template)
    frame.set('relativeHeight', str(251658240 + i * 1024))
    x, y, width, height = 60 + 260 * (i % 2), 75 + 105 * (i // 2), 210, 65
    case.update(x=x, y=y, width=width, height=height)
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
    for position, color in case['stops']:
        add(add(stops, 'a:gs', pos=position), 'a:srgbClr', val=color)
    add(gradient, 'a:lin', ang=case['angle'] * 60000, scaled='1' if case['scaled'] else '0')
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
