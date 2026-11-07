"""Independent signed anchor-offset controls; no renderer serialization."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json, sys
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/anchor-offset-precision';OUT.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
with ZipFile(ROOT/'tests/fixtures/outline-curve-display/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find(f'{{{W}}}body');template=deepcopy(body.find(f'.//{{{W}}}drawing'));body.clear()
containers='--containers' in sys.argv
cases=[]
for page,(horizontal,vertical,sign) in enumerate([('page','page',1),('margin','margin',1),('margin','margin',-1),('column','paragraph',-1)]):
    p=E.SubElement(body,f'{{{W}}}p');pr=E.SubElement(p,f'{{{W}}}pPr')
    if page:E.SubElement(pr,f'{{{W}}}pageBreakBefore')
    E.SubElement(pr,f'{{{W}}}spacing',{f'{{{W}}}before':'0',f'{{{W}}}after':'0',f'{{{W}}}line':'20',f'{{{W}}}lineRule':'exact'})
    if containers and page>=2:
        table=E.SubElement(body,f'{{{W}}}tbl');tp=E.SubElement(table,f'{{{W}}}tblPr')
        E.SubElement(tp,f'{{{W}}}tblW',{f'{{{W}}}w':'6480',f'{{{W}}}type':'dxa'})
        E.SubElement(tp,f'{{{W}}}tblLayout',{f'{{{W}}}type':'fixed'})
        grid=E.SubElement(table,f'{{{W}}}tblGrid');E.SubElement(grid,f'{{{W}}}gridCol',{f'{{{W}}}w':'6480'})
        tr=E.SubElement(table,f'{{{W}}}tr');tc=E.SubElement(tr,f'{{{W}}}tc');tcp=E.SubElement(tc,f'{{{W}}}tcPr')
        E.SubElement(tcp,f'{{{W}}}tcW',{f'{{{W}}}w':'6480',f'{{{W}}}type':'dxa'})
        margins=E.SubElement(tcp,f'{{{W}}}tcMar')
        for side in ['top','left','bottom','right']:E.SubElement(margins,f'{{{W}}}{side}',{f'{{{W}}}w':'0',f'{{{W}}}type':'dxa'})
        p=E.SubElement(tc,f'{{{W}}}p');pr=E.SubElement(p,f'{{{W}}}pPr')
        E.SubElement(pr,f'{{{W}}}spacing',{f'{{{W}}}before':'0',f'{{{W}}}after':'0',f'{{{W}}}line':'20',f'{{{W}}}lineRule':'exact'})
    for row,phase in enumerate([.49,.51,.53,.55]):
        for col in range(4):
            n=deepcopy(template);ident=page*16+row*4+col+1
            x=(24+col*64+phase) if sign>0 else (-100+col*64-phase)
            y=(24+row*56+phase) if sign>0 else (-100+row*56-phase)
            anchor=n.find(f'.//{{{WP}}}anchor')
            for axis,base,value in [('H',horizontal,x),('V',vertical,y)]:
                pos=anchor.find(f'{{{WP}}}position{axis}');pos.set('relativeFrom',base);pos.find(f'{{{WP}}}posOffset').text=str(round(value*9525))
            for ext in [n.find(f'.//{{{WP}}}extent'),n.find(f'.//{{{A}}}xfrm/{{{A}}}ext')]:ext.set('cx',str(32*9525));ext.set('cy',str(24*9525))
            n.find(f'.//{{{WP}}}docPr').set('id',str(ident));n.find(f'.//{{{WP}}}docPr').set('name',f'offset-{ident}')
            n.find(f'.//{{{A}}}prstGeom').set('prst','rect')
            if containers and page<2:
                groupNS='http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'
                gd=n.find(f'.//{{{A}}}graphicData');child=gd[0];gd.remove(child);gd.set('uri',groupNS)
                group=E.SubElement(gd,f'{{{groupNS}}}wgp',nsmap={'wpg':groupNS})
                E.SubElement(group,f'{{{groupNS}}}cNvGrpSpPr')
                gp=E.SubElement(group,f'{{{groupNS}}}grpSpPr');xf=E.SubElement(gp,f'{{{A}}}xfrm')
                for tag,attrs in [('off',dict(x='0',y='0')),('ext',dict(cx=str(32*9525),cy=str(24*9525))),('chOff',dict(x='0',y='0')),('chExt',dict(cx=str(32*9525),cy=str(24*9525)))]:E.SubElement(xf,f'{{{A}}}{tag}',attrs)
                group.append(child)
            E.SubElement(p,f'{{{W}}}r').append(n)
            cases.append(dict(id=ident,page=page,horizontal=horizontal,vertical=vertical,xEmu=round(x*9525),yEmu=round(y*9525)))
sect=E.SubElement(body,f'{{{W}}}sectPr')
E.SubElement(sect,f'{{{W}}}pgSz',{f'{{{W}}}w':'8640',f'{{{W}}}h':'8640'})
E.SubElement(sect,f'{{{W}}}pgMar',{f'{{{W}}}{k}':v for k,v in dict(top='1920',right='240',bottom='240',left='1920',header='0',footer='0',gutter='0').items()})
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/('containers.docx' if containers else 'control.docx'),'w',ZIP_DEFLATED) as z:
    for n,data in parts.items():z.writestr(n,data)
(OUT/('containers-cases.json' if containers else 'cases.json')).write_text(json.dumps(cases,indent=2)+'\n')
