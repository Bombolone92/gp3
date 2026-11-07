"""Isolate child position versus child geometry inside a zero-width group."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
import json
from lxml import etree as E

root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/zero-axis-group-geometry'
folder.mkdir(parents=True,exist_ok=True)
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'a':'http://schemas.openxmlformats.org/drawingml/2006/main',
    'wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'wpg':'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
    'wps':'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'}
with ZipFile(root/'public/fixtures/zero-axis-groups.docx') as z:
    parts={name:z.read(name) for name in z.namelist()}
doc=E.fromstring(parts['word/document.xml']); paragraph=doc.find('.//w:p',ns)
runs=paragraph.findall('w:r',ns)
for run in runs[1:]: paragraph.remove(run)
paragraph.find('.//w:t',ns).text='Zero-axis child position and geometry controls'
records=[]
for cw in [0,36]:
    for width in [0,36]:
        for rotation in [0,45,90]:
            i=len(records); x,y=72+(i%3)*180,72+(i//3)*160
            name=f'childExtent-{cw}-lineWidth-{width}-rotation-{rotation}'
            color=f'{180+i*5:02X}{32+i*4:02X}{48+i*5:02X}'
            run=deepcopy(runs[1]);paragraph.append(run)
            anchor=run.find('.//wp:anchor',ns);anchor.set('relativeHeight',str(i+1))
            for axis,value in [('H',x),('V',y)]:
                anchor.find('wp:position'+axis+'/wp:posOffset',ns).text=str(value*12700)
            prop=anchor.find('wp:docPr',ns);prop.set('id',str(i+1));prop.set('name',name)
            group=anchor.find('.//wpg:wgp',ns)
            group.find('wpg:grpSpPr/a:xfrm/a:chExt',ns).set('cx',str(cw*12700))
            shape=group.find('wps:wsp',ns);xf=shape.find('wps:spPr/a:xfrm',ns)
            xf.set('rot',str(rotation*60000))
            off=xf.find('a:off',ns);off.set('x',str(12*12700));off.set('y',str(6*12700))
            ext=xf.find('a:ext',ns);ext.set('cx',str(width*12700));ext.set('cy',str(48*12700))
            if i==6:
                xf.set('flipV','1');name+='-flip-v'
            if i==9:
                nested=E.SubElement(group,'{'+ns['wpg']+'}grpSp')
                E.SubElement(nested,'{'+ns['wpg']+'}cNvGrpSpPr')
                props=deepcopy(group.find('wpg:grpSpPr',ns));nested.append(props)
                inner=props.find('a:xfrm',ns);inner.set('flipV','1')
                inner.find('a:ext',ns).set('cx',str(36*12700))
                group.remove(shape);nested.append(shape);name+='-nested-flip-v'
            prop.set('name',name)
            shape.find('.//a:srgbClr',ns).set('val',color)
            records.append(dict(name=name,x=x,y=y,color=color,childWidth=cw,lineWidth=width,lineHeight=48,rotation=rotation))
parts['word/document.xml']=E.tostring(doc,encoding='UTF-8',xml_declaration=True,standalone=True)
target=root/'public/fixtures/zero-axis-group-geometry.docx'
with ZipFile(target,'w',ZIP_DEFLATED) as z:
    for name,content in parts.items():z.writestr(name,content)
(folder/'cases.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
print(target)
