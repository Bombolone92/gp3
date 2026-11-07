"""Original controls for paragraph advancement after automatic-spaced objects."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
from canvas_group_fixture import NS, tag, add

ROOT = Path(__file__).resolve().parents[1]
with ZipFile(ROOT / 'public/fixtures/inline-object-baseline.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
root = E.fromstring(parts['word/document.xml'])
drawing = deepcopy(root.find('.//' + tag('w:drawing')))
body = root.find(tag('w:body')); body.clear()
cases = []
for mixed in [False, True]:
    for height in [7, 20, 72, 300]:
        for line in [0, 120, 240, 278, 360, 480]:
            cases.append(dict(id=f'K{len(cases)+1:02}', height=height, line=line, mixed=mixed))

def paragraph(text='', line=240, page_break=False):
    p = add(body, 'w:p'); pr = add(p, 'w:pPr')
    if page_break: add(pr, 'w:pageBreakBefore')
    add(pr, 'w:spacing', **{'w:before': 0, 'w:after': 0, 'w:line': line, 'w:lineRule': 'auto'})
    rp = add(pr, 'w:rPr'); add(rp, 'w:rFonts', **{'w:ascii': 'Times New Roman', 'w:hAnsi': 'Times New Roman'}); add(rp, 'w:sz', **{'w:val': 24})
    r = add(p, 'w:r'); r.append(deepcopy(rp))
    if text: add(r, 'w:t', text=text)
    return p, r

for i, case in enumerate(cases):
    paragraph(case['id'] + ' BEFORE', page_break=i > 0)
    p, r = paragraph('Text ' if case['mixed'] else '', line=case['line'])
    obj = deepcopy(drawing)
    obj.find('.//' + tag('wp:docPr')).set('id', str(i + 1))
    for name in ['wp:extent', 'a:ext']:
        for ext in obj.findall('.//' + tag(name)): ext.set('cy', str(case['height'] * 12700))
    r.append(obj)
    paragraph(case['id'] + ' AFTER')
sect = add(body, 'w:sectPr'); add(sect, 'w:pgSz', **{'w:w': 12240, 'w:h': 31680})
add(sect, 'w:pgMar', **{'w:top': 720, 'w:right': 720, 'w:bottom': 720, 'w:left': 720, 'w:header': 0, 'w:footer': 0, 'w:gutter': 0})
parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(ROOT / 'public/fixtures/inline-object-advance.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items(): z.writestr(name, data)
folder = ROOT / 'tests/fixtures/inline-object-advance'; folder.mkdir(exist_ok=True)
(folder / 'cases.json').write_text(json.dumps(cases, indent=2)+'\n', encoding='utf-8')

