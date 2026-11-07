"""Original bordered pairs of the noWrap margin controls."""
from pathlib import Path
import sys
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from xml.etree import ElementTree as E
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/nowrap-cell-margins'
size=int(sys.argv[1]) if len(sys.argv)>1 else 4
name=sys.argv[2] if len(sys.argv)>2 else 'bordered'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';q=lambda n:'{'+W+'}'+n;E.register_namespace('w',W)
with ZipFile(folder/'control.docx')as z:parts={n:z.read(n)for n in z.namelist()}
d=E.fromstring(parts['word/document.xml'])
for pr in d.iter(q('tblPr')):
 borders=E.Element(q('tblBorders'))
 for side in ['top','left','bottom','right','insideH','insideV']:E.SubElement(borders,q(side),{q('val'):'single',q('sz'):str(size),q('color'):'000000'})
 pr.insert(1,borders)
parts['word/document.xml']=E.tostring(d,encoding='utf-8')
with ZipFile(folder/(name+'.docx'),'w')as z:
 for name,data in parts.items():
  i=ZipInfo(name,(2026,9,25,13,0,0));i.create_system=0;i.external_attr=0o600<<16;z.writestr(i,data,compress_type=ZIP_DEFLATED)
