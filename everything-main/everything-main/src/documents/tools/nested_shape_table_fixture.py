"""Independent paired body/text-box tables varying margins and indent."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
from canvas_group_fixture import tag, add
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/nested-shape-tables'
OUT.mkdir(parents=True, exist_ok=True)
with ZipFile(ROOT / 'tests/fixtures/shape-tables/source.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
root = E.fromstring(parts['word/document.xml']); body = root.find(tag('w:body'))
frame = deepcopy(root.findall('.//' + tag('wp:inline'))[2])
outer = deepcopy(frame.find('.//' + tag('w:tbl')))
section = deepcopy(body.find(tag('w:sectPr'))); body.clear()
cases = [dict(parent=n) for n in [0, 2, 4, 8, 12]]
cases += [dict(parent=4, inner=n) for n in [0, 2, 5.4, 8]]
cases += [dict(parent=4, border=n) for n in [0, 4]]
cases += [dict(parent=4, indent=10)]
cases += [dict(parent=12, right=20, percent=100), dict(parent=12, right=20, align='center'), dict(parent=12, right=20, align='right'), dict(parent=12, right=20, indent=-10)]
for i, case in enumerate(cases):
    label = add(body, 'w:p')
    if i: add(add(label, 'w:pPr'), 'w:pageBreakBefore')
    add(add(label, 'w:r'), 'w:t', text=f'Nested table control {i+1}: {case}')
    def table(prefix):
        result = deepcopy(outer)
        parent = result.findall(tag('w:tr'))[1].findall(tag('w:tc'))[1]
        parent.find(tag('w:tcPr') + '/' + tag('w:tcMar') + '/' + tag('w:left')).set(tag('w:w'), str(round(case['parent'] * 20)))
        if 'right' in case: parent.find(tag('w:tcPr') + '/' + tag('w:tcMar') + '/' + tag('w:right')).set(tag('w:w'), str(case['right'] * 20))
        inner = parent.find(tag('w:tbl'))
        if 'percent' in case:
            width = inner.find(tag('w:tblPr') + '/' + tag('w:tblW')); width.set(tag('w:type'), 'pct'); width.set(tag('w:w'), str(case['percent'] * 50))
        if 'align' in case:
            pr = inner.find(tag('w:tblPr')); align = E.Element(tag('w:jc')); align.set(tag('w:val'), case['align']); pr.insert(1, align)
            width = pr.find(tag('w:tblW')); width.set(tag('w:type'), 'dxa'); width.set(tag('w:w'), '1440')
            for grid in inner.findall(tag('w:tblGrid') + '/' + tag('w:gridCol')): grid.set(tag('w:w'), '720')
            for width in inner.findall('.//' + tag('w:tcW')): width.set(tag('w:w'), '720')
        if 'inner' in case:
            pr = inner.find(tag('w:tblPr'))
            mar = E.Element(tag('w:tblCellMar'))
            for side in ['left', 'right']:
                add(mar, 'w:' + side, **{'w:w': round(case['inner'] * 20), 'w:type': 'dxa'})
            # tblCellMar precedes tblLook in CT_TblPr.
            pr.insert(list(pr).index(pr.find(tag('w:tblLook'))), mar)
        if 'indent' in case:
            pr = inner.find(tag('w:tblPr'))
            indent = E.Element(tag('w:tblInd')); indent.set(tag('w:w'), str(case['indent'] * 20)); indent.set(tag('w:type'), 'dxa')
            pr.insert(1, indent)
        if 'border' in case:
            for border in result.findall('.//' + tag('w:tcBorders') + '/*'):
                border.set(tag('w:val'), 'single' if case['border'] else 'nil'); border.set(tag('w:sz'), str(case['border'] * 8))
        for text in result.iter(tag('w:t')):
            text.text = {'R2C2':prefix+' outer', 'Nested A':prefix+' A', 'Nested B':prefix+' B'}.get(text.text, text.text)
        return result
    body.append(table('B')); add(body, 'w:p')
    inline = deepcopy(frame); inline.find(tag('wp:docPr')).set('id', str(1000+i))
    inline.find('.//' + tag('wps:bodyPr')).set('anchor', 't')
    content = inline.find('.//' + tag('w:txbxContent'))
    old = content.find(tag('w:tbl')); content.replace(old, table('S'))
    add(add(add(body, 'w:p'), 'w:r'), 'w:drawing').append(inline)
body.append(section); parts['word/document.xml'] = E.tostring(root)
with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items(): z.writestr(name, data)
(OUT / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
print(len(cases), 'paired controls')
