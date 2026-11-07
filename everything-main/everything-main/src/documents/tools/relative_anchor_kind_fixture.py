"""Original four-page body-picture and grouped-picture relative-size controls."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'public/fixtures/table-relative-anchors.docx'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';A='http://schemas.openxmlformats.org/drawingml/2006/main';G='http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'
with ZipFile(p) as z: original={n:z.read(n) for n in z.namelist()}
for mode in ['body','group']:
 parts=dict(original);r=E.fromstring(parts['word/document.xml']);body=r.find('{'+W+'}body');sect=deepcopy(body[-1]);children=list(body);body.clear()
 for i in range(4):
  title,table,after=children[i*3:i*3+3];body.append(title)
  if mode=='body':body.append(deepcopy(table.findall('{'+W+'}tr/{'+W+'}tc')[1].find('{'+W+'}p')))
  else:
   table.find('.//{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}anchor').set('behindDoc','0')
   data=table.find('.//{'+A+'}graphicData');pic=data[0];data.remove(pic);data.set('uri',G)
   group=E.SubElement(data,'{'+G+'}wgp',nsmap={'wpg':G});E.SubElement(group,'{'+G+'}cNvGrpSpPr');props=E.SubElement(group,'{'+G+'}grpSpPr');x=E.SubElement(props,'{'+A+'}xfrm')
   for n,attrs in [('off',dict(x='0',y='0')),('ext',dict(cx='914400',cy='457200')),('chOff',dict(x='0',y='0')),('chExt',dict(cx='914400',cy='457200'))]:E.SubElement(x,'{'+A+'}'+n,**attrs)
   group.append(pic);body.append(table)
  body.append(after)
 body.append(sect);parts['word/document.xml']=E.tostring(r)
 with ZipFile(ROOT/f'public/fixtures/relative-{mode}-anchors.docx','w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
