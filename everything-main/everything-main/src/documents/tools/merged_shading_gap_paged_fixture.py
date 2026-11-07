"""Page-cut variants of the original padding controls; no corpus XML is used."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/merged-shading-gap'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with ZipFile(folder / 'control.docx') as package:
    parts = {name: package.read(name) for name in package.namelist()}
document = E.fromstring(parts['word/document.xml'])
body = document.find(W+'body'); tables = body.findall(W+'tbl'); section = deepcopy(body.find(W+'sectPr'))
body.clear()
cases = []
for index, (name, table_index) in enumerate([('neighbor-last-only',14), ('owner-start',19)]):
    label = E.SubElement(body,W+'p')
    if index: E.SubElement(E.SubElement(label,W+'pPr'),W+'pageBreakBefore')
    E.SubElement(E.SubElement(label,W+'r'),W+'t').text = name
    table = deepcopy(tables[table_index])
    for height in table.iter(W+'trHeight'): height.set(W+'val','5200')
    body.append(table)
    for page in range(3): cases.append(dict(name=f'{name}-{page+1}'))
E.SubElement(body,W+'p');body.append(section)
parts['word/document.xml'] = E.tostring(document,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(folder/'paged.docx','w',ZIP_DEFLATED) as package:
    for name,data in parts.items():package.writestr(name,data)
(folder/'paged-cases.json').write_text(json.dumps(cases,indent=2)+'\n')
