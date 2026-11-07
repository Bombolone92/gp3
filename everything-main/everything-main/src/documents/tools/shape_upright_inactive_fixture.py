"""Original controls for inactive and explicit-false text orientation flags."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
ROOT=Path(__file__).resolve().parents[1]
S='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
with ZipFile(ROOT/'public/fixtures/shape-defaults.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml'])
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
# An empty paragraph still has a text-box node, but no ink to orient.
shape=list(r.iter('{'+S+'}wsp'))[3]
tx=E.Element('{'+S+'}txbx');content=E.SubElement(tx,'{'+W+'}txbxContent')
p=E.SubElement(content,'{'+W+'}p');pr=E.SubElement(p,'{'+W+'}pPr');E.SubElement(pr,'{'+W+'}jc',{'{'+W+'}val':'center'})
shape.insert(list(shape).index(shape.find('{'+S+'}bodyPr')),tx)
for body,value in zip(r.iter('{'+S+'}bodyPr'),['0','false','1','true',None,'0','false',None]):
 if value is not None:body.set('upright',value)
parts['word/document.xml']=E.tostring(r,encoding='UTF-8',xml_declaration=True,standalone=True)
with ZipFile(ROOT/'public/fixtures/shape-upright-inactive.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
(ROOT/'tests/fixtures/shape-upright-inactive').mkdir(exist_ok=True)
