"""Original DrawingML controls for empty effects and single-column spacing."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import NS, tag, add, shape

ROOT = Path(__file__).resolve().parents[1]
with ZipFile(ROOT / 'public/fixtures/dense-guides.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
root = E.fromstring(parts['word/document.xml'])
body = root.find(tag('w:body'))
anchor_template = deepcopy(root.find('.//' + tag('wp:anchor')))
section = deepcopy(body.find(tag('w:sectPr')))
body.clear()
add(add(add(body, 'w:p'), 'w:r'), 'w:t', text='Shape defaults controls')
for i in range(8):
    p = add(body, 'w:p')
    anchor = deepcopy(anchor_template)
    add(add(p, 'w:r'), 'w:drawing').append(anchor)
    for axis, value in [('H', 60 + 260 * (i % 2)), ('V', 100 + 140 * (i // 2))]:
        position = anchor.find(tag('wp:position' + axis))
        position.set('relativeFrom', 'page')
        position.find(tag('wp:posOffset')).text = str(value * 12700)
    ext = anchor.find(tag('wp:extent'))
    ext.set('cx', str(200 * 12700)); ext.set('cy', str(90 * 12700))
    nv = anchor.find(tag('wp:docPr'))
    nv.set('id', str(i + 1)); nv.set('name', f'Control {i + 1}')
    data = anchor.find('.//' + tag('a:graphicData'))
    data.clear(); data.set('uri', NS['wps'])
    s = shape(data, i + 1, 200 * 12700, 90 * 12700, 0, 0, 'DEECEC',
              text='Same text' if i >= 4 else None)
    props = s.find(tag('wps:spPr'))
    variant = i % 4
    if variant in [1, 3]: add(props, 'a:effectLst')
    if variant in [2, 3]: add(props, 'a:sp3d')
    if variant == 3:
        bp = s.find(tag('wps:bodyPr'))
        bp.set('numCol', '1'); bp.set('spcCol', '914400')
body.append(section)
parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(ROOT / 'public/fixtures/shape-defaults.docx', 'w', ZIP_DEFLATED) as z:
    for n, data in parts.items(): z.writestr(n, data)
