"""Independent singular-axis shadow and patterned-fill controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
import json
from lxml import etree as E

root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/zero-axis-group-effects';folder.mkdir(parents=True,exist_ok=True)
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'a':'http://schemas.openxmlformats.org/drawingml/2006/main',
    'wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'wpg':'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
    'wps':'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'}
def add(parent,name,**attrs):
    prefix,local=name.split(':');return E.SubElement(parent,'{'+ns[prefix]+'}'+local,**{k:str(v) for k,v in attrs.items()})
with ZipFile(root/'public/fixtures/zero-axis-groups.docx') as z:parts={name:z.read(name) for name in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);paragraph=doc.find('.//w:p',ns);runs=paragraph.findall('w:r',ns)
for run in runs[1:]:paragraph.remove(run)
paragraph.find('.//w:t',ns).text='Zero-axis shadow and patterned-fill controls'
records=[]
for i,name in enumerate(['vertical-shadow','horizontal-shadow','vertical-pattern','horizontal-pattern']):
    vertical=i%2==0;x,y=90+(i%2)*240,100+(i//2)*300
    run=deepcopy(runs[1 if vertical else 2]);paragraph.append(run)
    anchor=run.find('.//wp:anchor',ns);anchor.set('relativeHeight',str(i+1))
    prop=anchor.find('wp:docPr',ns);prop.set('id',str(i+1));prop.set('name',name)
    for axis,value in [('H',x),('V',y)]:anchor.find('wp:position'+axis+'/wp:posOffset',ns).text=str(value*12700)
    group=anchor.find('.//wpg:wgp',ns)
    group.find('wpg:grpSpPr/a:xfrm/a:chExt',ns).set('cx' if vertical else 'cy',str(36*12700))
    props=group.find('wps:wsp/wps:spPr',ns)
    color=f'{180+i*10:02X}{32+i*8:02X}{48+i*10:02X}';props.find('.//a:srgbClr',ns).set('val',color)
    if i<2:
        effect=add(add(props,'a:effectLst'),'a:outerShdw',blurRad=0,dist=127000,dir=0 if vertical else 5400000,sx=100000,sy=100000,algn='ctr',rotWithShape=1)
        add(effect,'a:srgbClr',val='00AA00')
    else:
        props.find('a:prstGeom',ns).set('prst','rect')
        props.find('a:xfrm/a:ext',ns).set('cx' if vertical else 'cy',str(36*12700))
        blank=props.find('a:noFill',ns);at=props.index(blank);props.remove(blank)
        fill=E.Element('{'+ns['a']+'}pattFill',prst='pct50');props.insert(at,fill)
        add(add(fill,'a:fgClr'),'a:srgbClr',val='0000FF')
        add(add(fill,'a:bgClr'),'a:srgbClr',val='FFFF00')
    records.append(dict(name=name,x=x,y=y,color=color,shadow=i<2))
parts['word/document.xml']=E.tostring(doc,encoding='UTF-8',xml_declaration=True,standalone=True)
target=root/'public/fixtures/zero-axis-group-effects.docx'
with ZipFile(target,'w',ZIP_DEFLATED) as z:
    for name,content in parts.items():z.writestr(name,content)
(folder/'cases.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
print(target)
