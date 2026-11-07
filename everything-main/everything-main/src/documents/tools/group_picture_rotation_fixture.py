"""Original nested-picture rotation controls using our own quadrant PNG."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import NS, tag, add

ROOT=Path(__file__).resolve().parents[1]
with ZipFile(ROOT/'public/fixtures/group-picture-flips.docx') as z:
    parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);body=root.find(tag('w:body'))
template=deepcopy(root.find('.//'+tag('wp:anchor')))
section=deepcopy(body.find(tag('w:sectPr')));body.clear()
angles=[0,30,44.999,45,45.001,90,135,180,225,270,315,-30,30,90,30,180]
for i,angle in enumerate(angles):
    if i%2==0:
        p=add(body,'w:p')
        if i: add(add(p,'w:pPr'),'w:pageBreakBefore')
        add(add(p,'w:r'),'w:t',text=f'Picture rotation controls {i//2+1}')
    anchor=deepcopy(template)
    for axis,value in [('H',234),('V',174+330*(i%2))]:
        anchor.find(tag('wp:position'+axis)+'/'+tag('wp:posOffset')).text=str(value*12700)
    anchor.set('relativeHeight',str(251658240+i*1024))
    nv=anchor.find(tag('wp:docPr'));nv.set('id',str(i+1));nv.set('name',f'Case {i+1}: {angle} degrees')
    pic=anchor.find('.//'+tag('pic:pic'));props=pic.find(tag('pic:spPr'));xf=props.find(tag('a:xfrm'))
    xf.set('rot',str(round(angle*60000)))
    if i in [12,15]:xf.set('flipH','1')
    if i==13:
        xf.set('flipV','1');crop=pic.find(tag('pic:blipFill')+'/'+tag('a:srcRect'));crop.set('l','25000');crop.set('t','-25000')
    if i in [14,15]:
        props.remove(props.find(tag('a:prstGeom')))
        geom=add(props,'a:custGeom');add(geom,'a:avLst');add(geom,'a:gdLst');add(geom,'a:ahLst');add(geom,'a:cxnLst')
        path=add(add(geom,'a:pathLst'),'a:path',w=100,h=100)
        coords=[(0,0),(100,0),(0,100)] if i==14 else [(0,100),(100,100),(100,0),(0,0)]
        for j,(x,y) in enumerate(coords):add(add(path,'a:moveTo' if j==0 else 'a:lnTo'),'a:pt',x=x,y=y)
        add(path,'a:close')
    add(add(add(body,'w:p'),'w:r'),'w:drawing').append(anchor)
body.append(section)
parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(ROOT/'public/fixtures/group-picture-rotation.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
