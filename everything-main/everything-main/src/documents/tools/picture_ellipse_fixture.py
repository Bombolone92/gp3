"""Original ellipse-picture controls, with crop, reflection, effects and inline placement."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import tag,add
import json
ROOT=Path(__file__).resolve().parents[1]
with ZipFile(ROOT/'public/fixtures/floating-picture-crop.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);body=r.find(tag('w:body'));body[0].find('.//'+tag('w:t')).text='Ellipse picture controls'
for pic in r.iter(tag('pic:pic')):
 props=pic.find(tag('pic:spPr'));props.remove(props.find(tag('a:custGeom')));geom=add(props,'a:prstGeom',prst='ellipse');add(geom,'a:avLst')
# Add an untransformed inline grayscale ellipse on a separate page.
anchor=deepcopy(r.find('.//'+tag('wp:anchor')));inline=E.Element(tag('wp:inline'))
for name in ['extent','effectExtent','docPr','cNvGraphicFramePr']:
 n=anchor.find(tag('wp:'+name))
 if n is not None:inline.append(deepcopy(n))
inline.append(deepcopy(anchor.find(tag('a:graphic'))));inline.find(tag('wp:docPr')).set('id','9');inline.find(tag('wp:docPr')).set('name','E8')
pic=inline.find('.//'+tag('pic:pic'));pic.find('.//'+tag('pic:cNvPr')).set('id','9');add(pic.find('.//'+tag('a:blip')),'a:grayscl')
p=E.Element(tag('w:p'));add(add(p,'w:pPr'),'w:pageBreakBefore');add(add(p,'w:r'),'w:drawing').append(inline);body.insert(len(body)-1,p)
parts['word/document.xml']=E.tostring(r,encoding='UTF-8',xml_declaration=True,standalone=True)
with ZipFile(ROOT/'public/fixtures/picture-ellipse.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
cases=json.loads((ROOT/'tests/fixtures/floating-picture-crop/cases.json').read_text())
for c in cases:c['page']=0
cases.append(dict(id='E8',page=1,width=144,height=72))
folder=ROOT/'tests/fixtures/picture-ellipse';folder.mkdir(exist_ok=True);(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
