"""Vary original directional controls to isolate cross-axis alignment padding."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
repo=Path(__file__).resolve().parents[1];folder=repo/'tests/fixtures/cell-text-direction';W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with ZipFile(folder/'control.docx') as z:base={n:z.read(n) for n in z.namelist()}
for name,left,right,size in [('swapped',240,120,8),('zero',0,0,8),('thick',120,240,32)]:
 parts=dict(base);root=E.fromstring(parts['word/document.xml']);body=root.find(W+'body')
 for c in list(body)[9:-1]:body.remove(c)
 for e in root.iter(W+'tcMar'):
  e.find(W+'left').set(W+'w',str(left));e.find(W+'right').set(W+'w',str(right))
 for e in root.iter(W+'tblBorders'):
  for side in e:side.set(W+'sz',str(size))
 parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
 with ZipFile(folder/(name+'.docx'),'w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
