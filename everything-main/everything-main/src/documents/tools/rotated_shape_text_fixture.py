"""Original visible shape-text rotation controls; no corpus XML or artwork."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
import json
from lxml import etree as E
from canvas_group_fixture import tag, add, shape, NS

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/rotated-shape-text'
OUT.mkdir(exist_ok=True)
with ZipFile(ROOT/'public/fixtures/shape-theme.docx') as z:
    parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);body=r.find(tag('w:body'))
anchor=deepcopy(r.find('.//'+tag('wp:anchor')))
sect=deepcopy(body.find(tag('w:sectPr')));body.clear()
add(add(add(body,'w:p'),'w:r'),'w:t',text='Independent visible shape-text rotation controls')
cases=[dict(angle=a) for a in [0,30,44.999,45,45.001,90,135,180,225,270,315,-30]]
cases += [dict(angle=30,flipH=True),dict(angle=90,flipV=True),
          dict(angle=30,scaleX=2,scaleY=.5),dict(angle=90,scaleX=.5,scaleY=2),
          dict(angle=90,upright=True),dict(angle=30,parentAngle=90)]
cases += [dict(angle=a,upright=True) for a in [30,135,225,315]]
cases += [dict(angle=30,parentAngle=90,upright=True),dict(angle=90,scaleX=.5,scaleY=2,upright=True)]
for i,case in enumerate(cases):
    if i and i%18==0:add(add(add(body,'w:p'),'w:r'),'w:br',**{'w:type':'page'})
    a=deepcopy(anchor);x=45+(i%3)*170;y=55+((i%18)//3)*115
    for axis,value in [('H',x),('V',y)]:
        p=a.find(tag('wp:position'+axis));p.set('relativeFrom','page')
        p.find(tag('wp:posOffset')).text=str(value*12700)
    a.find(tag('wp:extent')).set('cx',str(120*12700));a.find(tag('wp:extent')).set('cy',str(90*12700))
    a.find(tag('wp:docPr')).set('id',str(i+1));a.find(tag('wp:docPr')).set('name',f'Rotation control {i+1}')
    data=a.find('.//'+tag('a:graphicData'));data.clear();data.set('uri',NS['wpg'])
    g=add(data,'wpg:wgp');add(g,'wpg:cNvGrpSpPr');t=add(add(g,'wpg:grpSpPr'),'a:xfrm')
    if case.get('parentAngle'):t.set('rot',str(round(case['parentAngle']*60000)))
    for name,attrs in [('off',dict(x=0,y=0)),('ext',dict(cx=120*12700,cy=90*12700)),
                       ('chOff',dict(x=0,y=0)),('chExt',dict(cx=round(120*12700/case.get('scaleX',1)),cy=round(90*12700/case.get('scaleY',1))))]:
        add(t,'a:'+name,**attrs)
    s=shape(g,100+i,70*12700,32*12700,20*12700,29*12700,'EEEEEE','Abc 12')
    xf=s.find('wps:spPr/a:xfrm',NS);xf.set('rot',str(round(case['angle']*60000)))
    for flag in ['flipH','flipV']:
        if case.get(flag):xf.set(flag,'1')
    rp=s.find('.//'+tag('w:rPr'));fonts=E.Element(tag('w:rFonts'))
    for name in ['ascii','hAnsi','eastAsia','cs']:fonts.set(tag('w:'+name),'Arial')
    rp.insert(0,fonts);rp.find(tag('w:sz')).set(tag('w:val'),'20')
    bp=s.find(tag('wps:bodyPr'));bp.set('lIns','25400');bp.set('rIns','25400');bp.set('tIns','25400');bp.set('bIns','25400')
    if case.get('upright'):bp.set('upright','1')
    add(add(add(body,'w:p'),'w:r'),'w:drawing').append(a)
    case.update(index=i+1,page=i//18+1,x=x,y=y)
body.append(sect);parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
