"""Author grid/row phases with a constant physical border declaration.

This control isolates frame coordinates from the pen-width phase control.
Only standard-library OOXML/ZIP authoring is used.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET
import hashlib, json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/print-frame-grid'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
ET.register_namespace('w', W)

def node(parent, name, **attrs):
    return ET.SubElement(parent, '{'+W+'}'+name, {'{'+W+'}'+k:str(v) for k,v in attrs.items()})

OUT.mkdir(parents=True, exist_ok=True)
with ZipFile(ROOT / 'tests/fixtures/print-border-phase/control.docx') as shell:
    source = ET.fromstring(shell.read('word/document.xml'))
    source.attrib.clear()
    body = source.find('{'+W+'}body')
    section = body.find('{'+W+'}sectPr')
    body.clear()
    cases = []
    for index in range(8):
        width = 4317 + index
        height = 400 + index
        cases.append(dict(index=index, widthTwips=width, heightTwips=height, sizeEighthPoints=8, indentTwips=0))
        table = node(body, 'tbl'); pr = node(table, 'tblPr')
        node(pr, 'tblW', w=width, type='dxa'); node(pr, 'jc', val='left'); node(pr, 'tblInd', w=0, type='dxa')
        borders = node(pr, 'tblBorders')
        for side in ['top','left','bottom','right']:
            node(borders, side, val='single', sz=8, color='6D7F91')
        node(pr, 'tblLayout', type='fixed'); margins = node(pr, 'tblCellMar')
        for side in ['top','left','bottom','right']: node(margins, side, w=0, type='dxa')
        node(node(table, 'tblGrid'), 'gridCol', w=width)
        row = node(table, 'tr'); node(node(row, 'trPr'), 'trHeight', val=height, hRule='exact')
        cell = node(row, 'tc'); cpr = node(cell, 'tcPr')
        node(cpr, 'tcW', w=width, type='dxa'); node(cpr, 'shd', val='clear', fill='DDEEFF')
        for parent, line in [(cell,20),(body,120)]:
            p = node(parent, 'p'); ppr = node(p, 'pPr')
            node(ppr, 'spacing', before=0, after=0, line=line, lineRule='exact')
            node(node(ppr, 'rPr'), 'sz', val=2)
    body.append(section)
    xml = ET.tostring(source, encoding='utf-8', xml_declaration=True)
    with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as target:
        for name in shell.namelist(): target.writestr(name, xml if name=='word/document.xml' else shell.read(name))
(OUT / 'cases.json').write_bytes((json.dumps(cases, indent=2)+'\n').encode('utf-8'))
print(json.dumps(dict(cases=len(cases), sourceSha256=hashlib.sha256((OUT/'control.docx').read_bytes()).hexdigest())))
