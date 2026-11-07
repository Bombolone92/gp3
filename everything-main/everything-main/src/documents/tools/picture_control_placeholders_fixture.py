"""Mark the original picture-control cases as showing placeholder contents."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import shutil

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/picture-controls'
out = root / 'placeholders'
out.mkdir(exist_ok=True)
ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(root / 'control.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
x = E.fromstring(parts['word/document.xml'])
for pr in x.findall('.//{%s}sdtPr' % ns):
    pr.find('{%s}picture' % ns).addprevious(E.Element('{%s}showingPlcHdr' % ns))
parts['word/document.xml'] = E.tostring(x, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(out / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items():
        z.writestr(name, data)
for name in ['cases.json', 'replacement.png']:
    shutil.copyfile(root / name, out / name)
