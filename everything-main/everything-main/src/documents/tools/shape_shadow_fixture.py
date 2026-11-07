"""Original theme/direct shape-shadow controls; no corpus content."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json

root = Path(__file__).resolve().parents[1]
out = root/'tests/fixtures/shape-shadows'
out.mkdir(exist_ok=True)
ns = {'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'a':'http://schemas.openxmlformats.org/drawingml/2006/main',
      'wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
      'wps':'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
      'wpg':'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'}
def tag(name):
    prefix,local = name.split(':'); return '{'+ns[prefix]+'}'+local
def add(parent,name,**attrs): return E.SubElement(parent,tag(name),{k:str(v) for k,v in attrs.items()})
def shadow(parent, direction=0, rotate='0', color='000000', blur=4):
    effect = add(parent,'a:effectLst')
    node = add(effect,'a:outerShdw',blurRad=blur*12700,dist=12*12700,dir=direction*60000)
    if rotate is not None: node.set('rotWithShape',rotate)
    add(add(node,'a:srgbClr',val=color),'a:alpha',val=50000)
    return effect

cases = [dict(name='no-effect',index=0), dict(name='inherited',index=1),
         dict(name='direct-empty',index=1,direct='empty'),
         dict(name='direct-shadow',index=1,direct='shadow'),
         dict(name='empty-theme',index=2),dict(name='direct-without-theme',index=0,direct='shadow'),
         dict(name='rotated-fixed',index=0,direct='shadow',rotation=30,rotate='0'),
         dict(name='rotated-with-shape',index=0,direct='shadow',rotation=30,rotate='1'),
         dict(name='rotated-default',index=0,direct='shadow',rotation=30,rotate=None),
         dict(name='flipped-fixed',index=0,direct='shadow',flip=True,rotate='0'),
         dict(name='flipped-with-shape',index=0,direct='shadow',flip=True,rotate='1'),
         dict(name='group-double',index=1,group=[2,2]),
         dict(name='group-stretched',index=1,group=[2,1]),
         dict(name='group-rotated-fixed',index=0,direct='shadow',group=[1,1],groupRotation=30,rotate='0'),
         dict(name='group-rotated-with-shape',index=0,direct='shadow',group=[1,1],groupRotation=30,rotate='1'),
         dict(name='outline-only',index=1,noFill=True),
         dict(name='translucent-fill',index=1,alpha=50000),
         dict(name='ellipse-inherited',index=1,ellipse=True,rotation=180),
         dict(name='theme-placeholder',index=3),dict(name='text-and-outline',index=1,noFill=True,text=True)]
with ZipFile(root/'public/fixtures/shape-theme.docx') as z:
    parts = {n:z.read(n) for n in z.namelist()}
doc = E.fromstring(parts['word/document.xml']); body = doc.find('w:body',ns)
template = deepcopy(doc.find('.//wp:anchor',ns)); section = deepcopy(body.find('w:sectPr',ns))
body.clear()
theme = E.fromstring(parts['word/theme/probe.xml'])
styles = theme.find('.//a:effectStyleLst',ns); styles.clear()
shadow(add(styles,'a:effectStyle'))
add(add(styles,'a:effectStyle'),'a:effectLst')
placeholder=shadow(add(styles,'a:effectStyle'),direction=90).find('a:outerShdw/a:srgbClr',ns)
placeholder.tag=tag('a:schemeClr');placeholder.set('val','phClr')
for i,case in enumerate(cases):
    p = add(body,'w:p')
    if i: add(add(p,'w:pPr'),'w:pageBreakBefore')
    add(add(p,'w:r'),'w:t').text = case['name']
    frame = deepcopy(template)
    for axis,value in [('H',120),('V',160)]: frame.find(f'wp:position{axis}/wp:posOffset',ns).text = str(value*12700)
    frame.find('wp:extent',ns).attrib.update(dict(cx=str(120*12700),cy=str(60*12700)))
    frame.find('wp:docPr',ns).attrib.update(dict(id=str(i+1),name=case['name']))
    shape = frame.find('.//wps:wsp',ns); props = shape.find('wps:spPr',ns)
    props.clear()
    xfrm = add(props,'a:xfrm')
    if case.get('rotation'): xfrm.set('rot',str(case['rotation']*60000))
    if case.get('flip'): xfrm.set('flipH','1')
    add(xfrm,'a:off',x=0,y=0); add(xfrm,'a:ext',cx=120*12700,cy=60*12700)
    add(add(props,'a:prstGeom',prst='ellipse' if case.get('ellipse') else 'rect'),'a:avLst')
    if case.get('noFill'): add(props,'a:noFill')
    else:
        color=add(add(props,'a:solidFill'),'a:srgbClr',val='228844')
        if case.get('alpha'): add(color,'a:alpha',val=case['alpha'])
    if case.get('noFill'): add(add(add(props,'a:ln',w=3*12700),'a:solidFill'),'a:srgbClr',val='228844')
    else: add(add(props,'a:ln'),'a:noFill')
    if case.get('direct')=='empty': add(props,'a:effectLst')
    elif case.get('direct')=='shadow': shadow(props,direction=0 if case.get('flip') else 90,color='8040C0',rotate=case.get('rotate','0'))
    shape.find('wps:style/a:effectRef',ns).set('idx',str(case['index']))
    if case.get('text'):
        text=E.Element(tag('wps:txbx'));paragraph=add(add(text,'w:txbxContent'),'w:p')
        run=add(paragraph,'w:r');rp=add(run,'w:rPr')
        add(rp,'w:rFonts').attrib.update({tag('w:ascii'):'Arial',tag('w:hAnsi'):'Arial'})
        add(rp,'w:color').set(tag('w:val'),'000000')
        add(run,'w:t').text='Shadow text'
        shape.insert(list(shape).index(shape.find('wps:bodyPr',ns)),text)
    if case.get('group'):
        data=frame.find('a:graphic/a:graphicData',ns); data.remove(shape); data.set('uri',ns['wpg'])
        group=add(data,'wpg:wgp'); add(group,'wpg:cNvGrpSpPr'); gp=add(group,'wpg:grpSpPr')
        transform=add(gp,'a:xfrm')
        if case.get('groupRotation'): transform.set('rot',str(case['groupRotation']*60000))
        sx,sy=case['group']
        add(transform,'a:off',x=0,y=0); add(transform,'a:ext',cx=120*12700*sx,cy=60*12700*sy)
        add(transform,'a:chOff',x=0,y=0); add(transform,'a:chExt',cx=120*12700,cy=60*12700)
        frame.find('wp:extent',ns).attrib.update(dict(cx=str(120*12700*sx),cy=str(60*12700*sy)))
        group.append(shape)
    add(add(add(body,'w:p'),'w:r'),'w:drawing').append(frame)
body.append(section)
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
parts['word/theme/probe.xml']=E.tostring(theme,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(out/'control.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items(): z.writestr(name,data)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
