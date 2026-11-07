"""Original text-box controls for exact, minimum and automatic line spacing."""
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
add(add(add(body, 'w:p'), 'w:r'), 'w:t', text='Text box line spacing controls')
cases = [('exact', 160, 't'), ('exact', 280, 't'), ('exact', 480, 't'),
         ('exact', 720, 't'), ('atLeast', 280, 't'), ('auto', 240, 't'),
         ('exact', 280, 'ctr'), ('exact', 280, 'b')]
for i, (rule, spacing, alignment) in enumerate(cases):
    anchor = deepcopy(anchor_template)
    add(add(add(body, 'w:p'), 'w:r'), 'w:drawing').append(anchor)
    for axis, value in [('H', 60 + 260 * (i % 2)), ('V', 100 + 140 * (i // 2))]:
        pos = anchor.find(tag('wp:position' + axis))
        pos.set('relativeFrom', 'page')
        pos.find(tag('wp:posOffset')).text = str(value * 12700)
    ext = anchor.find(tag('wp:extent'))
    ext.set('cx', str(200 * 12700)); ext.set('cy', str(110 * 12700))
    nv = anchor.find(tag('wp:docPr'))
    nv.set('id', str(i + 1)); nv.set('name', f'{rule} {spacing} {alignment}')
    data = anchor.find('.//' + tag('a:graphicData'))
    data.clear(); data.set('uri', NS['wps'])
    s = shape(data, i + 1, 200 * 12700, 110 * 12700, 0, 0, 'FFFFFF', text='Agyp H')
    bp = s.find(tag('wps:bodyPr'))
    for name in ['lIns', 'rIns', 'tIns', 'bIns']: bp.set(name, str(6 * 12700))
    bp.set('anchor', alignment)
    p = s.find('.//' + tag('w:p'))
    sp = p.find('.//' + tag('w:spacing'))
    sp.set(tag('w:lineRule'), rule); sp.set(tag('w:line'), str(spacing))
    rp = p.find('.//' + tag('w:rPr'))
    rp.find(tag('w:sz')).set(tag('w:val'), '48')
    rp.find(tag('w:color')).set(tag('w:val'), '123456')
    add(rp, 'w:rFonts', **{'w:ascii': 'Arial', 'w:hAnsi': 'Arial'})
    run = p.find(tag('w:r'))
    add(run, 'w:br'); add(run, 'w:t', text='Agyp H')
body.append(section)
parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(ROOT / 'public/fixtures/shape-exact-spacing.docx', 'w', ZIP_DEFLATED) as z:
    for n, data in parts.items(): z.writestr(n, data)
