from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from pathlib import Path
repo=Path(__file__).resolve().parents[1];folder=repo/'tests/fixtures/diagram-order-normalization';folder.mkdir(exist_ok=True)
p=repo/'tests/fixtures/diagram-linear-layout/control.docx';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(p) as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);body=r.find('{'+W+'}body');keep=[body[2],body[3],body[-1]]
for c in list(body):
 if c not in keep:body.remove(c)
for p in body.iter('{'+W+'}pageBreakBefore'):p.getparent().remove(p)
parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)

nonzero={n:(b.replace(b'{00000000-0000-0000-0000-000000000000}',b'{00000000-0000-0000-0000-000000009999}') if '/diagrams/' in n and n.endswith('.xml') else b) for n,b in parts.items()}
with ZipFile(folder/'control-nonzero.docx','w',ZIP_DEFLATED) as z:
 for n,b in nonzero.items():z.writestr(n,b)
