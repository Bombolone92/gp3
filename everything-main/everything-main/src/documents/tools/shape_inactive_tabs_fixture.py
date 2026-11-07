"""Original shape controls for unused positional paragraph tab stops."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
S = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
with ZipFile(ROOT / 'public/fixtures/shape-defaults.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
root = E.fromstring(parts['word/document.xml'])
for i, shape in enumerate(root.iter(f'{{{S}}}wsp')):
    tx = shape.find(f'{{{S}}}txbx')
    if tx is None:
        tx = E.Element(f'{{{S}}}txbx')
        E.SubElement(E.SubElement(tx, f'{{{W}}}txbxContent'), f'{{{W}}}p')
        shape.insert(list(shape).index(shape.find(f'{{{S}}}bodyPr')), tx)
    p = tx.find(f'.//{{{W}}}p')
    pr = p.find(f'{{{W}}}pPr')
    if pr is None:
        pr = E.Element(f'{{{W}}}pPr'); p.insert(0, pr)
    tabs = E.Element(f'{{{W}}}tabs'); pr.insert(0, tabs)
    E.SubElement(tabs, f'{{{W}}}tab', {
        f'{{{W}}}val': ['left', 'center', 'right', 'decimal'][i % 4],
        f'{{{W}}}pos': '600', f'{{{W}}}leader': 'dot',
    })
parts['word/document.xml'] = E.tostring(root, encoding='UTF-8', xml_declaration=True, standalone=True)
with ZipFile(ROOT / 'public/fixtures/shape-inactive-tabs.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items(): z.writestr(name, data)
(ROOT / 'tests/fixtures/shape-inactive-tabs').mkdir(exist_ok=True)
