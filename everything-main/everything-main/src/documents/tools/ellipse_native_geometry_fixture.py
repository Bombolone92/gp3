"""Original ellipse controls separating physical geometry from raster sampling."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E
import argparse, json, hashlib

ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
WPS='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
WPG='http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'

def generate(out,holdout=False,grouped=False):
    with ZipFile(ROOT/'tests/fixtures/outline-curve-display/control.docx') as z:
        parts={n:z.read(n) for n in z.namelist()}
    doc=E.fromstring(parts['word/document.xml']); cases=[]
    sizes=[(20.2,30.7),(60.47244094488189,40.33),(50.5,50.5),(63.75,41.25)] if holdout or grouped else [(24,24),(60,60),(60.47244094488189,60.47244094488189),(64,40)]
    for i,node in enumerate(doc.iter(f'{{{W}}}drawing')):
        row,col=divmod(i,4);phase=[0,.25,.5,.75][row]
        width,height=sizes[col];x=24+88*col+phase;y=24+64*row+phase
        props=node.find(f'.//{{{WPS}}}spPr')
        for tag in ['prstGeom','custGeom']:
            old=props.find(f'{{{A}}}{tag}')
            if old is not None:props.remove(old)
        geom=E.Element(f'{{{A}}}prstGeom',prst='ellipse');E.SubElement(geom,f'{{{A}}}avLst')
        props.insert(1,geom)
        for axis,value in [('H',x),('V',y)]:node.find(f'.//{{{WP}}}position{axis}/{{{WP}}}posOffset').text=str(round(value*9525))
        for extent in [node.find(f'.//{{{WP}}}extent'),props.find(f'{{{A}}}xfrm/{{{A}}}ext')]:
            extent.set('cx',str(round(width*9525)));extent.set('cy',str(round(height*9525)))
        pen=6350 if row<2 else 28575
        line=props.find(f'{{{A}}}ln');line.clear();line.set('w',str(pen))
        E.SubElement(E.SubElement(line,f'{{{A}}}solidFill'),f'{{{A}}}srgbClr',val='000000')
        node.find(f'.//{{{WP}}}docPr').set('name',f'Original ellipse {i+1}')
        if grouped:
            sx,sy=[(2,.5),(1.5,2),(.5,1.5),(3,2)][col]
            outer_x,outer_y=round(width*9525),round(height*9525)
            inner_x,inner_y=round(outer_x/sx),round(outer_y/sy)
            props.find(f'{{{A}}}xfrm/{{{A}}}ext').set('cx',str(inner_x))
            props.find(f'{{{A}}}xfrm/{{{A}}}ext').set('cy',str(inner_y))
            data=node.find(f'.//{{{A}}}graphicData');shape=data[0];data.remove(shape);data.set('uri',WPG)
            group=E.SubElement(data,f'{{{WPG}}}wgp',nsmap={'wpg':WPG})
            E.SubElement(group,f'{{{WPG}}}cNvGrpSpPr')
            transform=E.SubElement(E.SubElement(group,f'{{{WPG}}}grpSpPr'),f'{{{A}}}xfrm')
            for tag,attrs in [('off',dict(x='0',y='0')),('ext',dict(cx=str(outer_x),cy=str(outer_y))),('chOff',dict(x='0',y='0')),('chExt',dict(cx=str(inner_x),cy=str(inner_y)))]:
                E.SubElement(transform,f'{{{A}}}{tag}',**attrs)
            group.append(shape)
        cases.append(dict(id=i+1,xEmu=round(x*9525),yEmu=round(y*9525),
            widthEmu=round(width*9525),heightEmu=round(height*9525),penEmu=pen,phase=phase))
    parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
    out.mkdir(parents=True,exist_ok=True)
    document_name='grouped' if grouped else ('holdout' if holdout else 'control')
    with ZipFile(out/(document_name+'.docx'),'w',ZIP_DEFLATED) as z:
        for name,data in parts.items():
            info=ZipInfo(name,(2026,10,3,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
    (out/('cases.json' if document_name=='control' else document_name+'-cases.json')).write_bytes((json.dumps(cases,indent=2)+'\n').encode())
    print(hashlib.sha256((out/(document_name+'.docx')).read_bytes()).hexdigest())

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path)
    parser.add_argument('--holdout',action='store_true');parser.add_argument('--grouped',action='store_true');args=parser.parse_args()
    generate(args.output,args.holdout,args.grouped)
