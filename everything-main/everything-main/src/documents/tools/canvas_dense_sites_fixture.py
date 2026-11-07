"""Original custom shape with 16,384 retained connection sites."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
ROOT=Path(__file__).resolve().parents[1]
A='{http://schemas.openxmlformats.org/drawingml/2006/main}'
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with ZipFile(ROOT/'public/fixtures/dense-guides.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);r.find('.//'+W+'t').text='Dense connection sites'
c=r.find('.//'+A+'custGeom');g=c.find(A+'gdLst');g.clear()
E.SubElement(g,A+'gd',name='g32767',fmla='val 32768')
sites=c.find(A+'cxnLst')
if sites is None:
 sites=E.Element(A+'cxnLst');c.insert(list(c).index(c.find(A+'pathLst')),sites)
for i in range(16384):
 site=E.SubElement(sites,A+'cxn',ang='0')
 E.SubElement(site,A+'pos',x=str(i*2),y='0')
parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(ROOT/'public/fixtures/dense-sites.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(ROOT/'tests/fixtures/dense-sites').mkdir(exist_ok=True)
