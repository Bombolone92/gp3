"""Original screen-curve controls, independently constructed as DrawingML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/outline-curve-display'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
with ZipFile(ROOT / 'tests/fixtures/outline-display-width/modern.docx') as z:
    parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']); body=doc.find(f'{{{W}}}body')
template=deepcopy(body.find(f'.//{{{W}}}drawing')); body.clear()
p=E.SubElement(body,f'{{{W}}}p'); cases=[]

def point(parent,x,y): E.SubElement(parent,f'{{{A}}}pt',x=str(x),y=str(y))
def move(path,x,y): point(E.SubElement(path,f'{{{A}}}moveTo'),x,y)
def cubic(path,*coords):
    c=E.SubElement(path,f'{{{A}}}cubicBezTo')
    for x,y in zip(coords[::2],coords[1::2]): point(c,x,y)

boundary = '--phase-boundaries' in sys.argv
name = 'phase-boundaries' if boundary else 'control'
for row,phase in enumerate([0.49,0.51,0.53,0.55] if boundary else [0,0.25,0.5,0.75]):
    for col,kind in enumerate(['ellipse','cubic-ellipse','open-cubic','triangle']):
        node=deepcopy(template); ident=row*4+col+1
        x,y=24+col*88+phase,24+row*64+phase
        for axis,value in [('H',x),('V',y)]: node.find(f'.//{{{WP}}}position{axis}/{{{WP}}}posOffset').text=str(round(value*9525))
        for extent in [node.find(f'.//{{{WP}}}extent'),node.find(f'.//{{{A}}}xfrm/{{{A}}}ext')]:
            extent.set('cx',str(64*9525)); extent.set('cy',str(40*9525))
        node.find(f'.//{{{WP}}}docPr').set('id',str(ident))
        node.find(f'.//{{{WP}}}docPr').set('name',f'{kind}-{phase}')
        node.find(f'.//{{{A}}}ln').set('w','4327')
        geom=node.find(f'.//{{{A}}}prstGeom')
        if kind=='ellipse': geom.set('prst','ellipse')
        else:
            custom=E.Element(f'{{{A}}}custGeom')
            for tag in ['avLst','gdLst','ahLst','cxnLst']: E.SubElement(custom,f'{{{A}}}{tag}')
            E.SubElement(custom,f'{{{A}}}rect',l='0',t='0',r='r',b='b')
            path=E.SubElement(E.SubElement(custom,f'{{{A}}}pathLst'),f'{{{A}}}path',w='1000000',h='1000000',fill='none')
            if kind=='cubic-ellipse':
                k=276142
                move(path,0,500000)
                cubic(path,0,500000-k,500000-k,0,500000,0)
                cubic(path,500000+k,0,1000000,500000-k,1000000,500000)
                cubic(path,1000000,500000+k,500000+k,1000000,500000,1000000)
                cubic(path,500000-k,1000000,0,500000+k,0,500000)
                E.SubElement(path,f'{{{A}}}close')
            elif kind=='open-cubic':
                move(path,0,1000000); cubic(path,0,0,1000000,0,1000000,1000000)
            else:
                move(path,0,1000000)
                for px,py in [(500000,0),(1000000,1000000)]: point(E.SubElement(path,f'{{{A}}}lnTo'),px,py)
                E.SubElement(path,f'{{{A}}}close')
            geom.getparent().replace(geom,custom)
        E.SubElement(p,f'{{{W}}}r').append(node)
        cases.append(dict(id=ident,kind=kind,phase=phase,xEmu=round(x*9525),yEmu=round(y*9525),widthEmu=64*9525,heightEmu=40*9525,penEmu=4327))
section=E.SubElement(body,f'{{{W}}}sectPr')
E.SubElement(section,f'{{{W}}}pgSz',{f'{{{W}}}w':'5760',f'{{{W}}}h':'4320'})
E.SubElement(section,f'{{{W}}}pgMar',{f'{{{W}}}{k}':v for k,v in dict(top='120',right='120',bottom='120',left='120',header='0',footer='0',gutter='0').items()})
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
OUT.mkdir(exist_ok=True)
with ZipFile(OUT/(name+'.docx'),'w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
(OUT/('phase-boundaries-cases.json' if boundary else 'cases.json')).write_text(json.dumps(cases,indent=2)+'\n',encoding='utf8')
