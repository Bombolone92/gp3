"""Original XML controls for standalone floating-picture rotation."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
from canvas_group_fixture import tag, add, NS
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/floating-picture-rotation'
OUT.mkdir(parents=True, exist_ok=True)
with ZipFile(ROOT / 'tests/fixtures/wmf-vectors/control.docx') as z:
    parts = {n: z.read(n) for n in z.namelist() if not n.startswith('word/media/')}
with ZipFile(ROOT / 'public/fixtures/group-picture-flips.docx') as z:
    parts['word/media/quadrants.png'] = z.read('word/media/quadrants.png')
root = E.fromstring(parts['word/document.xml']); body = root.find(tag('w:body'))
template = deepcopy(root.find('.//' + tag('wp:anchor')))
section = deepcopy(body.find(tag('w:sectPr'))); body.clear()
angles = [0, 30, 44.999, 45, 90, 135, 180, 225, 270, 315, -30, 630, 30, 90, 260, 30, 90, 30]
cases = []
for i, angle in enumerate(angles):
    if i % 6 == 0:
        p = add(body, 'w:p')
        if i: add(add(p, 'w:pPr'), 'w:pageBreakBefore')
        add(add(p, 'w:r'), 'w:t', text=f'Floating rotation controls {i // 6 + 1}')
    anchor = deepcopy(template)
    x, y = 100 + 270 * (i % 2), 130 + 210 * ((i % 6) // 2)
    for axis, value in [('H', x), ('V', y)]:
        pos = anchor.find(tag('wp:position' + axis)); pos.set('relativeFrom', 'page')
        pos.find(tag('wp:posOffset')).text = str(value * 12700)
    anchor.find(tag('wp:docPr')).set('id', str(i + 1))
    anchor.find(tag('wp:docPr')).set('name', f'Rotation {i + 1}: {angle}')
    anchor.find(tag('wp:extent')).attrib.update(dict(cx=str(120 * 12700), cy=str(60 * 12700)))
    effect = anchor.find(tag('wp:effectExtent'))
    if effect is None:
        effect = E.Element(tag('wp:effectExtent')); anchor.insert(list(anchor).index(anchor.find(tag('wp:extent'))) + 1, effect)
    effect.attrib.update(dict(l='0', t='0', r='0', b='0'))
    if i == 17: effect.attrib.update(dict(l=str(9 * 12700), t=str(3 * 12700), r=str(2 * 12700), b=str(7 * 12700)))
    pic = anchor.find('.//' + tag('pic:pic')); xf = pic.find('.//' + tag('a:xfrm'))
    xf.set('rot', str(round(angle * 60000)))
    xf.find(tag('a:ext')).attrib.update(dict(cx=str(120 * 12700), cy=str(60 * 12700)))
    if i in (12, 15): xf.set('flipH', '1')
    if i in (13, 15): xf.set('flipV', '1')
    fill = pic.find(tag('pic:blipFill'))
    fill.find(tag('a:blip')).set(tag('r:embed'), 'pixels')
    if i in (14, 15, 16):
        crop = E.Element(tag('a:srcRect')); crop.attrib.update(dict(l='25000', t='-25000' if i == 16 else '12500')); fill.insert(1, crop)
    if i == 15: add(fill.find(tag('a:blip')), 'a:alphaModFix', amt='50000')
    add(add(add(body, 'w:p'), 'w:r'), 'w:drawing').append(anchor)
    cases.append(dict(page=i // 6, x=x, y=y, width=120, height=60, angle=angle))
body.append(section); parts['word/document.xml'] = E.tostring(root)
rels = E.fromstring(parts['word/_rels/document.xml.rels'])
for r in list(rels):
    if r.get('Type', '').endswith('/image'): rels.remove(r)
E.SubElement(rels, '{' + E.QName(rels).namespace + '}Relationship', Id='pixels', Type=NS['r'] + '/image', Target='media/quadrants.png')
parts['word/_rels/document.xml.rels'] = E.tostring(rels)
types = E.fromstring(parts['[Content_Types].xml'])
for n in list(types):
    if n.get('Extension') == 'wmf': types.remove(n)
E.SubElement(types, '{' + E.QName(types).namespace + '}Default', Extension='png', ContentType='image/png')
parts['[Content_Types].xml'] = E.tostring(types)
with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items(): z.writestr(name, data)
(OUT / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
