"""Original shaded controls derived from our original joined-border OPC fixture."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
q=lambda name:'{'+W+'}'+name
with ZipFile(ROOT/'public/fixtures/joined-border-spacing-15.docx') as z:
    parts={name:z.read(name) for name in z.namelist()}
root=E.fromstring(parts['word/document.xml'])
for pr in root.iter(q('pPr')):
    border=pr.find(q('pBdr'))
    if border is not None:
        pr.insert(list(pr).index(border)+1,E.Element(q('shd'),{q('val'):'clear',q('fill'):'224466'}))
        pr.find(q('spacing')).set(q('line'),'245')
parts['word/document.xml']=E.tostring(root)
with ZipFile(ROOT/'public/fixtures/paragraph-shading-seams.docx','w',ZIP_DEFLATED) as z:
    for name,content in parts.items():z.writestr(name,content)
