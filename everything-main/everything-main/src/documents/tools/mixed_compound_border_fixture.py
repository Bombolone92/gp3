"""Original complementary compound-border corners; no corpus content."""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
from lxml import etree as E

repo = Path(__file__).resolve().parents[1]
out = repo / 'tests/fixtures/mixed-compound-borders'
out.mkdir(parents=True, exist_ok=True)
with ZipFile(repo / 'public/fixtures/inline-object-baseline.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
root = E.fromstring(parts['word/document.xml'])
w = '{' + root.nsmap['w'] + '}'
body = root.find(w + 'body'); sect = deepcopy(body[-1]); body.clear()
def add(parent, name, **attrs):
    return E.SubElement(parent, w + name, {w + k: str(v) for k, v in attrs.items()})
def borders(parent, name, case):
    container = add(parent, name)
    for side, color in zip(['top', 'left', 'bottom', 'right'], ['CC0000', '008800', '0000CC', '880088']):
        add(container, side, val=case['sides'][side], sz=case['size'], space=0, color=color, frame=int(case['frame']))
cases = []
for gap in ['Small', 'Medium']:
    for frame in [False, True]:
        for mask in range(16):
            case = dict(page=len(cases), style=gap, size=36, frame=frame,
                sides={side: ('thinThick' if mask & (1 << i) else 'thickThin') + gap + 'Gap' for i, side in enumerate(['top', 'left', 'bottom', 'right'])})
            label = add(body, 'p'); pr = add(label, 'pPr')
            if cases: add(pr, 'pageBreakBefore')
            add(pr, 'spacing', before=0, after=240)
            add(add(label, 'r'), 't').text = f'{gap}; mask={mask}; frame={int(frame)}'
            p = add(body, 'p'); pr = add(p, 'pPr'); borders(pr, 'pBdr', case)
            add(pr, 'spacing', before=0, after=480, line=720, lineRule='exact')
            add(pr, 'ind', right=5040); add(add(p, 'r'), 't').text = 'Paragraph border'
            table = add(body, 'tbl'); pr = add(table, 'tblPr')
            add(pr, 'tblW', w=4320, type='dxa'); borders(pr, 'tblBorders', case)
            add(pr, 'tblLayout', type='fixed'); add(add(table, 'tblGrid'), 'gridCol', w=4320)
            row = add(table, 'tr'); add(add(row, 'trPr'), 'trHeight', val=1080, hRule='exact')
            cell = add(row, 'tc'); add(add(cell, 'tcPr'), 'tcW', w=4320, type='dxa')
            p = add(cell, 'p'); add(add(p, 'pPr'), 'spacing', before=0, after=0)
            add(add(p, 'r'), 't').text = 'Table border'; add(body, 'p'); cases.append(case)
body.append(sect)
parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(out / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items(): z.writestr(name, data)
(out / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')
print(f'Wrote {len(cases)} paired paragraph/table pages')
