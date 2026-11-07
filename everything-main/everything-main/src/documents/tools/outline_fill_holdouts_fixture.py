"""Original filled geometry and mixed-group screen controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json

root=Path(__file__).resolve().parents[1]
out=root/'tests/fixtures/outline-fill-holdouts';out.mkdir(exist_ok=True)
A='http://schemas.openxmlformats.org/drawingml/2006/main'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
WPG='http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'
WPS='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
for mode in ['combined','group']:
    with ZipFile(root/'tests/fixtures/outline-curve-display/control.docx') as z:
        parts={n:z.read(n) for n in z.namelist()}
    doc=E.fromstring(parts['word/document.xml']);cases=[]
    for i,node in enumerate(doc.iter(f'{{{W}}}drawing')):
        row,col=divmod(i,4);phase=[0,.25,.5,.75][row]
        x,y=24+col*88+phase,16+row*64+phase
        for axis,value in [('H',x),('V',y)]:node.find(f'.//{{{WP}}}position{axis}/{{{WP}}}posOffset').text=str(round(value*9525))
        props=node.find(f'.//{{{WPS}}}spPr')
        if col==0:props.find(f'{{{A}}}prstGeom').set('prst','rect')
        for path in props.findall(f'.//{{{A}}}path'):path.set('fill','norm')
        nofill=props.find(f'{{{A}}}noFill');fill=E.Element(f'{{{A}}}solidFill')
        E.SubElement(fill,f'{{{A}}}srgbClr',val='D5D5D5');props.replace(nofill,fill)
        if mode=='group':
            data=node.find(f'.//{{{A}}}graphicData');shape=data[0];data.remove(shape);data.set('uri',WPG)
            group=E.SubElement(data,f'{{{WPG}}}wgp',nsmap={'wpg':WPG})
            E.SubElement(group,f'{{{WPG}}}cNvGrpSpPr')
            transform=E.SubElement(E.SubElement(group,f'{{{WPG}}}grpSpPr'),f'{{{A}}}xfrm')
            for tag,attrs in [('off',dict(x='0',y='0')),('ext',dict(cx=str(64*9525),cy=str(48*9525))),('chOff',dict(x='0',y='0')),('chExt',dict(cx=str(64*9525),cy=str(48*9525)))]:E.SubElement(transform,f'{{{A}}}{tag}',**attrs)
            pen=deepcopy(shape);penprops=pen.find(f'{{{WPS}}}spPr')
            for tag in ['prstGeom','custGeom']:
                geom=penprops.find(f'{{{A}}}{tag}')
                if geom is not None:penprops.remove(geom)
            linegeom=E.Element(f'{{{A}}}prstGeom',prst='line');E.SubElement(linegeom,f'{{{A}}}avLst');penprops.insert(1,linegeom)
            penprops.replace(penprops.find(f'{{{A}}}solidFill'),E.Element(f'{{{A}}}noFill'))
            penprops.find(f'{{{A}}}xfrm/{{{A}}}off').set('y',str(44*9525))
            penprops.find(f'{{{A}}}xfrm/{{{A}}}ext').set('cy','0')
            line=props.find(f'{{{A}}}ln');line.clear();E.SubElement(line,f'{{{A}}}noFill')
            group.append(shape);group.append(pen)
            node.find(f'.//{{{WP}}}extent').set('cy',str(48*9525))
        cases.append(dict(id=i+1,mode=mode,kind=['rect','cubic-ellipse','open-cubic','triangle'][col],phase=phase,xCss=x,yCss=y,widthCss=64,heightCss=40))
    parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
    with ZipFile(out/(mode+'.docx'),'w',ZIP_DEFLATED) as z:
        for name,data in parts.items():z.writestr(name,data)
    (out/(mode+'-cases.json')).write_text(json.dumps(cases,indent=2)+'\n')
