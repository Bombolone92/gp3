"""Original paired AutoFit picture controls: vary only table width preference."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/autofit-picture-preferences'
OUT.mkdir(exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
with ZipFile(ROOT / 'public/fixtures/table-unbreakable-modern-picture.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
root = E.fromstring(parts['word/document.xml'])
body = root.find('{'+W+'}body')
table = deepcopy(body.find('{'+W+'}tbl'))
section = deepcopy(body.find('{'+W+'}sectPr'))
body.clear()
cases = []
for kind in ['auto', 'dxa', 'pct', 'omitted']:
    for points in [504, 280]:
        case = dict(id=len(cases), preference=kind, pictureWidthPt=points)
        cases.append(case)
        p = E.SubElement(body, '{'+W+'}p')
        pr = E.SubElement(p, '{'+W+'}pPr')
        if case['id']:
            E.SubElement(pr, '{'+W+'}pageBreakBefore')
        run = E.SubElement(p, '{'+W+'}r')
        E.SubElement(run, '{'+W+'}t').text = f'{kind} width, {points} pt picture'
        t = deepcopy(table)
        width = t.find('.//{'+W+'}tblW')
        if kind == 'omitted':
            width.getparent().remove(width)
        else:
            width.set('{'+W+'}type', kind)
            width.set('{'+W+'}w', {'auto': '0', 'dxa': '5760', 'pct': '5000'}[kind])
        t.find('.//{'+WP+'}extent').set('cx', str(points * 12700))
        # Keep the picture transform and inline frame consistent. The parent
        # fixture's different aspect ratios exercise another rendering issue.
        inner = t.find('.//{'+A+'}xfrm/{'+A+'}ext')
        inner.set('cx', str(points * 12700))
        inner.set('cy', '1828800')
        for node in t.findall('.//{'+WP+'}docPr'):
            node.set('id', str(case['id'] + 10))
        body.append(t)
body.append(section)
parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items():
        z.writestr(name, data)
(OUT / 'cases.json').write_text(json.dumps(cases, indent=2)+'\n', encoding='utf8')
