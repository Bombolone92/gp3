from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
ROOT=Path(__file__).resolve().parents[1]
A='http://schemas.openxmlformats.org/drawingml/2006/main';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
ns={'a':A,'w':W,'wp':WP}
# Original authored controls, derived only from our own formula fixture.
cases=[('repeat',[('g','val 25'),('g','val 75'),('percent','val g')],[]),('snapshot',[('g','val 25'),('saved','val g'),('g','val 75'),('percent','val saved')],[]),('self-reference',[('g','val 25'),('g','+- g 25 0'),('percent','val g')],[]),('adjustment-guide',[('g','val 75'),('percent','val g')],[('g','val 25')]),('repeat-adjustment',[('percent','val g')],[('g','val 25'),('g','val 75')]),('builtin',[('w','val 1143000'),('percent','*/ w 100 2286000')],[])]
cases += [('self-double',[('g','val 25'),('g','*/ g 2 1'),('percent','+- g 10 0')],[]),('self-offset',[('g','val 25'),('g','+- g 40 0'),('percent','val g')],[]),('first-self',[('g','+- g 60 0'),('percent','val g')],[])]
# Built-in self-reference remains unsupported: the native exploratory control
# produced off-page geometry rather than the ordinary-guide zero binding.
with ZipFile(ROOT/'public/fixtures/custom-geometry-guides.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find('w:body',ns);template=deepcopy(body.findall('w:p',ns)[1]);sect=deepcopy(body.find('w:sectPr',ns));title=deepcopy(body[0]);title.find('.//w:t',ns).text='Repeated geometry guides';body.clear();body.append(title);manifest=[]
for i,(name,guides,adjustments) in enumerate(cases):
 p=deepcopy(template);geom=p.find('.//a:custGeom',ns)
 for tag,items in [('avLst',adjustments),('gdLst',guides+[('pathEnd','*/ percent 2286000 100')])]:
  lst=geom.find('a:'+tag,ns);lst.clear()
  for key,formula in items:E.SubElement(lst,'{'+A+'}gd',name=key,fmla=formula)
 geom.find('a:cxnLst',ns).clear();rect=geom.find('a:rect',ns)
 for key,val in [('l','0'),('t','0'),('r','r'),('b','b')]:rect.set(key,val)
 y=95+70*i;p.find('.//wp:positionV/wp:posOffset',ns).text=str(y*12700);dp=p.find('.//wp:docPr',ns);dp.set('id',str(i+1));dp.set('name',name)
 body.append(p);manifest.append(dict(name=name,x=54,y=y,width=180,height=20))
body.append(sect);parts['word/document.xml']=E.tostring(doc,encoding='UTF-8',xml_declaration=True,standalone=True)
with ZipFile(ROOT/'public/fixtures/geometry-guide-rebinding.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
folder=ROOT/'tests/fixtures/geometry-guide-rebinding';folder.mkdir(exist_ok=True);(folder/'cases.json').write_text(json.dumps(manifest,indent=2)+'\n')
