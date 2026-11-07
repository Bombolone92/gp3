"""Original group rotations over nonuniform scales, nested groups and pictures."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import tag
ROOT=Path(__file__).resolve().parents[1]
with ZipFile(ROOT/'public/fixtures/group-shape-rotation.docx')as z:parts={n:z.read(n)for n in z.namelist()}
with ZipFile(ROOT/'public/fixtures/group-picture-rotation.docx')as z:pictures=E.fromstring(z.read('word/document.xml'))
r=E.fromstring(parts['word/document.xml'])
angles=[0,30,44.999,45,45.001,90,135,180,225,270,315,-30,30,90,30,180]
for i,group in enumerate(r.iter(tag('wpg:wgp'))):
 group.find(tag('wpg:grpSpPr')+'/'+tag('a:xfrm')).set('rot',str(round(angles[i]*60000)))
 nested=group.find(tag('wpg:grpSp'))
 if i>=12:nested.find(tag('wpg:grpSpPr')+'/'+tag('a:xfrm')).set('rot',str((i-11)*30*60000))
 shape=group.find('.//'+tag('wps:wsp'))
 shape.find(tag('wps:spPr')+'/'+tag('a:xfrm')).attrib.pop('rot',None)
 if i in range(8,12):
  pic=deepcopy(list(pictures.iter(tag('pic:pic')))[i])
  pic.find(tag('pic:spPr')+'/'+tag('a:xfrm')).set('rot','1800000' if i==11 else '0')
  shape.getparent().replace(shape,pic)
 elif i>=14:shape.find(tag('wps:spPr')+'/'+tag('a:xfrm')).set('rot','1800000')
for t in r.iter(tag('w:t')):
 if t.text:t.text=t.text.replace('Shape rotation controls','Group rotation controls')
parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(ROOT/'public/fixtures/group-rotation.docx','w',ZIP_DEFLATED)as z:
 for n,b in parts.items():z.writestr(n,b)
