"""Original reference controls for oval marker dimensions and path endpoints."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
from lxml import etree as E
from canvas_group_fixture import NS, tag, add

root = Path(__file__).resolve().parents[1]
folder = root/'tests/fixtures/oval-markers'
folder.mkdir(parents=True, exist_ok=True)
with ZipFile(root/'tests/fixtures/flat-lines/flat-lines.docx') as z:
    parts = {n:z.read(n) for n in z.namelist()}
document = E.Element(tag('w:document'), nsmap=NS)
body = add(document, 'w:body')
p = add(body, 'w:p'); add(add(p, 'w:r'), 'w:t', text='Oval marker controls')
cases = []
sizes = [(length, width) for length in ['sm','med','lg'] for width in ['sm','med','lg']]
names = ['thin', 'thick', 'head', 'diagonal', 'curve', 'closed', 'group-scaled', 'group-rotated', 'collapsed-group']
names += ['pen-0', 'pen-0.14', 'pen-1', 'pen-1.5', 'pen-2.5', 'pen-3']
names += ['pen-0.01','pen-0.1','pen-0.2','pen-0.24','pen-0.25','pen-0.3','pen-0.4','pen-0.49','pen-0.5']
names += ['curve-wide','alpha','dashed']
for i, case in enumerate(sizes + names):
    if i == 18:
        p=add(body,'w:p');add(add(p,'w:pPr'),'w:pageBreakBefore');add(add(p,'w:r'),'w:t',text='Oval marker minimum-size controls')
    name = '-'.join(case) if isinstance(case, tuple) else case
    x, y = 48 + (i%3)*180, 84 + ((i%18)//3)*108
    color = f'{160+i*2:02X}{25+i*3:02X}{40+i:02X}'
    width = .5 if name == 'thin' else 6 if name == 'thick' else 2
    if name.startswith('pen-'):width=float(name[4:])
    records = dict(name=name, color=color, x=x, y=y, pen=width, page=i//18)
    if name=='alpha':records['opacity']=.5
    cases.append(records)
    frame = add(add(add(p,'w:r'),'w:drawing'),'wp:anchor', distT=0,distB=0,distL=0,distR=0,
                simplePos=0,relativeHeight=i+1,behindDoc=0,locked=0,layoutInCell=1,allowOverlap=1)
    add(frame,'wp:simplePos',x=0,y=0)
    for axis,value in [('H',x),('V',y)]: add(add(frame,'wp:position'+axis,relativeFrom='page'),'wp:posOffset',text=str(value*12700))
    h = 36 if name in ['diagonal','curve','closed','group-scaled','group-rotated'] else 0
    if name=='curve-wide':h=54
    add(frame,'wp:extent',cx=108*12700,cy=h*12700)
    add(frame,'wp:effectExtent',l=0,t=0,r=0,b=0);add(frame,'wp:wrapNone');add(frame,'wp:docPr',id=i+1,name=name)
    grouped = name in ['group-scaled','group-rotated','collapsed-group']
    data=add(add(frame,'a:graphic'),'a:graphicData',uri=NS['wpg' if grouped else 'wps'])
    parent=data
    if grouped:
        parent=add(data,'wpg:wgp');add(parent,'wpg:cNvGrpSpPr')
        xf=add(add(parent,'wpg:grpSpPr'),'a:xfrm',**({'rot':2700000} if name=='group-rotated' else {}))
        add(xf,'a:off',x=0,y=0);add(xf,'a:ext',cx=108*12700,cy=h*12700)
        add(xf,'a:chOff',x=0,y=0);add(xf,'a:chExt',cx=54*12700,cy=36*12700)
    shape=add(parent,'wps:wsp');add(shape,'wps:cNvCnPr')
    props=add(shape,'wps:spPr');xf=add(props,'a:xfrm')
    add(xf,'a:off',x=0,y=0);add(xf,'a:ext',cx=(54 if grouped else 108)*12700,cy=(36 if grouped else h)*12700)
    if name in ['curve','curve-wide']:
        geom=add(props,'a:custGeom');add(geom,'a:avLst');add(geom,'a:gdLst');add(geom,'a:ahLst');add(geom,'a:cxnLst')
        add(geom,'a:rect',l='l',t='t',r='r',b='b')
        path=add(add(geom,'a:pathLst'),'a:path',w=108,h=h,fill='none')
        add(add(path,'a:moveTo'),'a:pt',x=0,y=h)
        curve=add(path,'a:cubicBezTo')
        for xx,yy in [(0,0),(54 if name=='curve-wide' else 108,0),(108,h)]:add(curve,'a:pt',x=xx,y=yy)
    else:add(add(props,'a:prstGeom',prst='rect' if name=='closed' else 'straightConnector1'),'a:avLst')
    add(props,'a:noFill')
    pen=add(props,'a:ln',w=round(width*12700),cap='flat');add(add(pen,'a:solidFill'),'a:srgbClr',val=color)
    if name=='alpha':add(pen.find('a:solidFill/a:srgbClr',{'a':NS['a']}),'a:alpha',val=50000)
    if name=='dashed':add(pen,'a:prstDash',val='dash')
    attrs=dict(type='oval')
    if isinstance(case,tuple):attrs.update(len=case[0],w=case[1])
    if name in ['diagonal','curve','curve-wide','closed']:add(pen,'a:headEnd',type='oval',len='lg',w='sm')
    add(pen,'a:headEnd' if name=='head' else 'a:tailEnd',**attrs)
    add(shape,'wps:bodyPr')
sect=add(body,'w:sectPr');add(sect,'w:pgSz',**{'w:w':12240,'w:h':15840})
add(sect,'w:pgMar',**{'w:top':720,'w:left':720,'w:right':720,'w:bottom':720,'w:header':0,'w:footer':0,'w:gutter':0})
parts['word/document.xml']=E.tostring(document,encoding='UTF-8',xml_declaration=True,standalone=True)
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
print(folder/'control.docx')
