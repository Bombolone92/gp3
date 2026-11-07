"""Author independent row-height/pen-width controls using only OOXML and ZIP."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET
from copy import deepcopy
import argparse, hashlib, json

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output-folder', type=Path)
args = parser.parse_args()
OUT = args.output_folder or ROOT / 'tests/fixtures/print-row-pen-phase'
if OUT.exists() and (not OUT.is_dir() or any(OUT.iterdir())):
    parser.error('Use a fresh or empty output folder to preserve captured sources.')
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
ET.register_namespace('w', W)
def node(parent, name, **attrs):
    return ET.SubElement(parent, '{'+W+'}'+name, {'{'+W+'}'+k:str(v) for k,v in attrs.items()})

OUT.mkdir(parents=True, exist_ok=True)
with ZipFile(ROOT / 'tests/fixtures/print-frame-grid/control.docx') as shell:
    doc = ET.fromstring(shell.read('word/document.xml')); doc.attrib.clear()
    body = doc.find('{'+W+'}body')
    template = deepcopy(body.find('{'+W+'}tbl'))
    section = deepcopy(body.find('{'+W+'}sectPr'))
    body.clear(); cases = []
    for size in [3, 5, 8, 12, 16]:
        for height in range(396, 412):
            index = len(cases)
            table = deepcopy(template); body.append(table)
            for tag in ['tblW', 'gridCol', 'tcW']:
                table.find('.//{'+W+'}'+tag).set('{'+W+'}w', '4320')
            for border in table.find('.//{'+W+'}tblBorders'):
                border.set('{'+W+'}sz', str(size))
            table.find('.//{'+W+'}trHeight').set('{'+W+'}val', str(height))
            cases.append(dict(index=index, page=index, heightTwips=height,
                              sizeEighthPoints=size, widthTwips=4320))
            ppr = node(node(body, 'p'), 'pPr')
            node(ppr, 'spacing', before=0, after=0, line=20, lineRule='exact')
            node(node(ppr, 'rPr'), 'sz', val=2)
            if index < 79:
                boundary = deepcopy(section)
                boundary.insert(0, ET.Element('{'+W+'}type', {'{'+W+'}val':'nextPage'}))
                ppr.append(boundary)
    body.append(section)
    xml = ET.tostring(doc, encoding='utf-8', xml_declaration=True)
    with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as target:
        for name in shell.namelist():
            target.writestr(name, xml if name=='word/document.xml' else shell.read(name))
(OUT / 'cases.json').write_bytes((json.dumps(cases, indent=2)+'\n').encode('utf-8'))
print(json.dumps(dict(cases=len(cases), sourceSha256=hashlib.sha256((OUT/'control.docx').read_bytes()).hexdigest())))
