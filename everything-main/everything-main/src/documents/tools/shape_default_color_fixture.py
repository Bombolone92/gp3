"""Independent document-default color variant of the authored shape color matrix."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
root=Path(__file__).resolve().parents[1]
source=root/'tests/fixtures/shape-auto-color';out=root/'tests/fixtures/shape-default-color';out.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(source/'control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/styles.xml']);rp=r.find('{'+W+'}docDefaults/{'+W+'}rPrDefault/{'+W+'}rPr')
assert rp is not None
for c in rp.findall('{'+W+'}color'):rp.remove(c)
c=E.Element('{'+W+'}color');c.set('{'+W+'}val','112233')
# CT_RPrBase order: color follows fonts/booleans and precedes spacing/size.
at=next((i for i,n in enumerate(rp) if E.QName(n).localname in ['spacing','w','kern','position','sz','szCs','highlight','u','effect','bdr','shd','fitText','vertAlign','rtl','cs','em','lang']),len(rp));rp.insert(at,c)
parts['word/styles.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(out/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(out/'cases.json').write_bytes((source/'cases.json').read_bytes())
