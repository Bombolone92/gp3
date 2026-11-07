"""Original paired noWrap variants of the mixed-width controls."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED,ZipInfo
from xml.etree import ElementTree as E
root=Path(__file__).resolve().parents[1]/'tests/fixtures/mixed-cell-width-preferences'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';E.register_namespace('w',W);q=lambda s:'{'+W+'}'+s
with ZipFile(root/'control.docx')as z:parts={n:z.read(n)for n in z.namelist()}
d=E.fromstring(parts['word/document.xml'])
for cell in d.iter(q('tc')):
 pr=cell.find(q('tcPr'));shd=pr.find(q('shd'))
 if shd is not None and shd.get(q('fill'))in ['FFCC99','CCFF99']:E.SubElement(pr,q('noWrap'))
parts['word/document.xml']=E.tostring(d,encoding='utf-8')
with ZipFile(root/'nowrap.docx','w')as z:
 for name,data in parts.items():
  info=ZipInfo(name,(2026,9,25,13,0,0));info.create_system=0;info.external_attr=0o600<<16;z.writestr(info,data,compress_type=ZIP_DEFLATED)
