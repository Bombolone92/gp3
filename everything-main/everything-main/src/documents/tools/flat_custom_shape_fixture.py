"""Independent zero-extent custom paths; no corpus geometry or artwork."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
from lxml import etree as E
from canvas_group_fixture import NS, tag, add

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'tests/fixtures/flat-custom-shapes'
FOLDER.mkdir(parents=True, exist_ok=True)
emu = lambda pt: round(pt * 12700)
with ZipFile(ROOT / 'public/fixtures/numeric-page-fields.docx') as z:
    parts = {n:z.read(n) for n in ['[Content_Types].xml', '_rels/.rels',
        'word/styles.xml', 'word/settings.xml', 'word/_rels/document.xml.rels']}
document = E.Element(tag('w:document'), nsmap=NS)
body = add(document, 'w:body')
p = add(body, 'w:p')
add(add(p, 'w:r'), 'w:t', text='Zero-extent custom shape controls')
cases = []
for i, (width, height, explicit, stroke) in enumerate(
        (w,h,e,s) for w,h in [(72,0),(0,72),(0,0)]
        for e in [False,True] for s in [False,True]):
    x,y = 72+(i%3)*180, 90+(i//3)*160
    color = f'{160+i*6:02X}{32+i*5:02X}{64+i*3:02X}'
    name = f'{width}x{height}-explicit-{explicit}-stroke-{stroke}'
    anchor = add(add(add(p,'w:r'),'w:drawing'),'wp:anchor', distT=0,
        distB=0,distL=0,distR=0,simplePos=0,relativeHeight=i+1,
        behindDoc=0,locked=0,layoutInCell=1,allowOverlap=1)
    add(anchor,'wp:simplePos',x=0,y=0)
    for axis,value in [('H',x),('V',y)]:
        add(add(anchor,'wp:position'+axis,relativeFrom='page'),
            'wp:posOffset',text=str(emu(value)))
    add(anchor,'wp:extent',cx=emu(100),cy=emu(100))
    add(anchor,'wp:effectExtent',l=0,t=0,r=0,b=0)
    add(anchor,'wp:wrapNone'); add(anchor,'wp:docPr',id=i+1,name=name)
    data=add(add(anchor,'a:graphic'),'a:graphicData',uri=NS['wpg'])
    group=add(data,'wpg:wgp'); add(group,'wpg:cNvGrpSpPr')
    xf=add(add(group,'wpg:grpSpPr'),'a:xfrm')
    add(xf,'a:off',x=0,y=0); add(xf,'a:ext',cx=emu(100),cy=emu(100))
    add(xf,'a:chOff',x=0,y=0); add(xf,'a:chExt',cx=emu(100),cy=emu(100))
    shape=add(group,'wps:wsp'); add(shape,'wps:cNvSpPr')
    props=add(shape,'wps:spPr'); xf=add(props,'a:xfrm')
    add(xf,'a:off',x=0,y=0); add(xf,'a:ext',cx=emu(width),cy=emu(height))
    geom=add(props,'a:custGeom')
    for name_ in ['avLst','gdLst','ahLst','cxnLst']: add(geom,'a:'+name_)
    add(geom,'a:rect',l=0,t=0,r='r',b='b')
    path=add(add(geom,'a:pathLst'),'a:path',**({'w':100,'h':100} if explicit else {}))
    # Absolute coordinates deliberately leave the zero frame: test whether
    # omitted path dimensions differ from an explicit coordinate viewport.
    size=100 if explicit else emu(48)
    for command,points in [('moveTo',[(0,0)]),
            ('cubicBezTo',[(size,0),(size,size),(0,size)]),
            ('lnTo',[(0,0)])]:
        cmd=add(path,'a:'+command)
        for px,py in points:add(cmd,'a:pt',x=px,y=py)
    add(path,'a:close')
    add(add(props,'a:solidFill'),'a:srgbClr',val=color)
    pen=add(props,'a:ln',w=25400,cap='rnd')
    if stroke:add(add(pen,'a:solidFill'),'a:srgbClr',val=color)
    else:add(pen,'a:noFill')
    add(shape,'wps:bodyPr')
    cases.append(dict(name=name,x=x,y=y,width=width,height=height,
        explicit=explicit,stroke=stroke,color=color))
sect=add(body,'w:sectPr'); add(sect,'w:pgSz',**{'w:w':12240,'w:h':15840})
add(sect,'w:pgMar',**{'w:top':720,'w:left':720,'w:right':720,'w:bottom':720,
    'w:header':0,'w:footer':0,'w:gutter':0})
parts['word/document.xml']=E.tostring(document,encoding='UTF-8',xml_declaration=True,standalone=True)
parts['word/footer.xml']=f'<w:ftr xmlns:w="{NS["w"]}"><w:p/></w:ftr>'.encode()
target=ROOT/'public/fixtures/flat-custom-shapes.docx'
with ZipFile(target,'w',ZIP_DEFLATED) as z:
    for name,content in parts.items():z.writestr(name,content)
(FOLDER/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
print(target)
