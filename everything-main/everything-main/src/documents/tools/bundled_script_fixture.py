"""Adapt the original script-size matrix to the application's bundled face."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree
import json
root=Path(__file__).resolve().parents[1]
base=root/'tests/fixtures/script-size'
target=root/'tests/fixtures/bundled-script';target.mkdir(exist_ok=True)
with ZipFile(base/'control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
doc=etree.fromstring(parts['word/document.xml']);body=doc.find(W+'body')
for child in list(body)[39:-1]:body.remove(child)
for node in doc.iter(W+'rFonts'):
    for key in ['ascii','hAnsi']:node.set(W+key,'Noto Sans')
for node in doc.iter(W+'t'):
    if node.text and node.text.startswith('Garamond'):node.text=node.text.replace('Garamond','Noto Sans')
parts['word/document.xml']=etree.tostring(doc)
with ZipFile(target/'control.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
cases=json.loads((base/'cases.json').read_text())[:3]
for case in cases:case['family']='Noto Sans'
(target/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
print(target/'control.docx')
