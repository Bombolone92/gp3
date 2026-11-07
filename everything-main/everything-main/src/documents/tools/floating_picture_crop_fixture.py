"""Original floating custom-picture crop/flip controls, assembled as XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import tag,add,NS
import json,sys
rootdir=Path(__file__).resolve().parents[1]
with ZipFile(rootdir/'public/fixtures/picture-geometry.docx') as z:parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);body=root.find(tag('w:body'))
template=next(deepcopy(n) for n in root.iter(tag('wp:anchor')) if n.find('.//'+tag('a:graphicData')).get('uri')==NS['pic'])
section=deepcopy(body.find(tag('w:sectPr')));body.clear();add(add(add(body,'w:p'),'w:r'),'w:t',text='Floating picture crop controls')
cases=[]
for i in range(8):
    a=deepcopy(template);x=60+260*(i%2);y=100+140*(i//2)
    for axis,value in [('H',x),('V',y)]:
        pos=a.find(tag('wp:position'+axis));pos.set('relativeFrom','page');pos.find(tag('wp:posOffset')).text=str(value*12700)
    a.find(tag('wp:docPr')).set('id',str(i+1));a.find(tag('wp:docPr')).set('name',f'C{i}')
    pic=a.find('.//'+tag('pic:pic'));transform=pic.find('.//'+tag('a:xfrm'))
    for axis,enabled in [('flipH',i in [2,4,6]),('flipV',i in [3,4])]:
        if enabled:transform.set(axis,'1')
        else:transform.attrib.pop(axis,None)
    crop=pic.find('.//'+tag('a:srcRect'))
    if crop is None:
        fill=pic.find(tag('pic:blipFill'));crop=E.Element(tag('a:srcRect'));fill.insert(1,crop)
    crop.attrib.clear()
    if i:crop.set('l','-50000' if i==5 else '25000');crop.set('t','-100000' if i==5 else '12500')
    if i==6:
        blip=pic.find('.//'+tag('a:blip'));effect=add(blip,'a:duotone');add(effect,'a:srgbClr',val='CC2244');add(effect,'a:prstClr',val='white');add(blip,'a:alphaModFix',amt=50000)
    if i==7:
        path=pic.find('.//'+tag('a:path'));points=list(path)
        # A nonrectangular clipping path, independent of the cropped viewport.
        point=points[2].find(tag('a:pt'));point.set('x','0');path.remove(points[3])
    add(add(add(body,'w:p'),'w:r'),'w:drawing').append(a)
    cases.append(dict(id=f'C{i}',x=x,y=y,width=144,height=72))
body.append(section);parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
out=Path(sys.argv[1]) if len(sys.argv)>1 else rootdir/'public/fixtures/floating-picture-crop.docx'
with ZipFile(out,'w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
casefile=out.with_suffix('.cases.json') if len(sys.argv)>1 else rootdir/'tests/fixtures/floating-picture-crop/cases.json'
casefile.parent.mkdir(parents=True,exist_ok=True)
casefile.write_text(json.dumps(cases,indent=2)+'\n')
