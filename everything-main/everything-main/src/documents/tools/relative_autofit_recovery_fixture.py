"""Original relative-size/autofit isolation controls; no renderer or corpus data used."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_first_section_fixture import parts as base, CT, REL, R
from canvas_group_fixture import NS, tag, add, shape, transform

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/relative-autofit-recovery'
folder.mkdir(parents=True, exist_ok=True)
NS['wp14'] = 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing'
root = E.Element(tag('w:document'), nsmap=NS)
root.set(tag('mc:Ignorable'), 'wp14')
body = add(root, 'w:body')
def paragraph(parent, text):
    p=add(parent,'w:p'); r=add(p,'w:r'); add(add(r,'w:rPr'),'w:b'); add(r,'w:t',text=text)
    return p
def drawing(parent, ident, grouped=False, field=None):
    frame=add(add(add(add(parent,'w:p'),'w:r'),'w:drawing'),'wp:inline',distT=0,distB=0,distL=0,distR=0)
    width,height=240*12700,(40 if grouped else 28)*12700
    add(frame,'wp:extent',cx=width,cy=height);add(frame,'wp:docPr',id=ident,name=f'Recovery {ident}');add(frame,'wp:cNvGraphicFramePr')
    data=add(add(frame,'a:graphic'),'a:graphicData',uri=NS['wpg' if grouped else 'wps'])
    host=data
    if grouped:
        host=add(data,'wpg:wgp');add(host,'wpg:cNvGrpSpPr');transform(add(host,'wpg:grpSpPr'),width,height,group=True)
        t=host.find('.//'+tag('a:xfrm'));t.find(tag('a:chOff')).attrib.update({'x':'0','y':'0'});t.find(tag('a:chExt')).attrib.update({'cx':str(width),'cy':str(height)})
    for i in range(2 if grouped else 1):
        value=field if i==0 else None
        s=shape(host,ident*10+i,(110 if grouped else 240)*12700,(40 if value else 10)*12700,i*125*12700,0,'DDEEFF' if value else 'DDEECC','Page ' if value else 'Healthy text grows onto several lines in its saved small frame. More text stays visible.')
        fit=s.find(tag('wps:bodyPr'));fit.remove(fit[0]);add(fit,'a:spAutoFit')
        if value:
            p=s.find('.//'+tag('w:p'));f=add(p,'w:fldSimple',**{'w:instr':f' {value} '});add(add(f,'w:r'),'w:t',text='99')
paragraph(body,'Healthy heading before drawings')
drawing(body,1)
paragraph(body,'Healthy content between drawings')
drawing(body,2)
table=add(body,'w:tbl');pr=add(table,'w:tblPr');add(pr,'w:tblW',**{'w:w':'4800','w:type':'dxa'});add(add(table,'w:tblGrid'),'w:gridCol',**{'w:w':'4800'})
cell=add(add(table,'w:tr'),'w:tc');add(add(cell,'w:tcPr'),'w:tcW',**{'w:w':'4800','w:type':'dxa'});paragraph(cell,'Healthy table retained')
drawing(body,3)
paragraph(body,'Healthy ending after drawings')
section=add(body,'w:sectPr');add(section,'w:headerReference',**{'w:type':'default','r:id':'header'})
add(section,'w:pgSz',**{'w:w':'12240','w:h':'15840'});add(section,'w:pgMar',**{'w:top':'1440','w:right':'1440','w:bottom':'1440','w:left':'1440','w:header':'360','w:footer':'360','w:gutter':'0'})
header=E.Element(tag('w:hdr'),nsmap=NS);drawing(header,4)
header.set(tag('mc:Ignorable'), 'wp14')
# Preserve complete, ordered anchor geometry and vary only autofit in the pair.
for tree in [root, header]:
    for frame in list(tree.iter(tag('wp:inline'))):
        ident = int(frame.find(tag('wp:docPr')).get('id'))
        if ident == 2: continue
        frame.tag = tag('wp:anchor')
        frame.attrib.update(dict(simplePos='0', relativeHeight=str(ident), behindDoc='0', locked='0', layoutInCell='1', allowOverlap='1'))
        pos = E.Element(tag('wp:simplePos'), x='0', y='0')
        frame.insert(0, pos)
        for i, axis in enumerate(['H','V']):
            pos = E.Element(tag('wp:position'+axis), relativeFrom='margin' if axis=='H' else 'paragraph')
            add(pos,'wp:posOffset',text='0')
            frame.insert(i+1,pos)
        frame.insert(4,E.Element(tag('wp:wrapNone')))
        relative=add(frame,'wp14:sizeRelH',relativeFrom='margin')
        add(relative,'wp14:pctWidth',text='50000')
for name in ['unsupported','matched','grouped-unsupported','grouped-matched']:
    document,story=deepcopy(root),deepcopy(header)
    if name.startswith('grouped-'):
        for tree in [document,story]:
            for frame in tree.iter(tag('wp:anchor')):
                ident=int(frame.find(tag('wp:docPr')).get('id'))
                # Height-only and two-axis placement, including a header story.
                if ident != 1:
                    if ident == 3: frame.remove(frame.find(tag('wp14:sizeRelH')))
                    add(add(frame,'wp14:sizeRelV',relativeFrom='page'),'wp14:pctHeight',text='5000')
                data=frame.find('.//'+tag('a:graphicData'))
                data.clear();data.set('uri',NS['wpg'])
                host=add(data,'wpg:wgp');add(host,'wpg:cNvGrpSpPr')
                transform(add(host,'wpg:grpSpPr'),240*12700,40*12700,group=True)
                xfrm=host.find('.//'+tag('a:xfrm'))
                xfrm.find(tag('a:chOff')).attrib.update({'x':'0','y':'0'})
                xfrm.find(tag('a:chExt')).attrib.update({'cx':str(240*12700),'cy':str(40*12700)})
                for i in range(2):
                    s=shape(host,ident*10+i,110*12700,40*12700,i*125*12700,0,'DDEEFF','Grouped text retained at its saved size. More text on several lines.')
                    fit=s.find(tag('wps:bodyPr'));fit.remove(fit[0]);add(fit,'a:spAutoFit' if i==0 else 'a:noAutofit')
    if name.endswith('matched'):
        for tree in [document,story]:
            for s in tree.iter(tag('wps:wsp')):
                if next(s.iterancestors(tag('wp:anchor')), None) is not None:
                    fit=s.find(tag('wps:bodyPr'));fit.remove(fit[0]);add(fit,'a:noAutofit')
    parts=dict(base)
    parts['word/document.xml']=E.tostring(document)
    parts['word/header.xml']=E.tostring(story)
    parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/header.xml" ContentType="{CT}header+xml"/></Types>')
    parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="header" Type="{R}/header" Target="header.xml"/></Relationships>')
    with ZipFile(folder/f'{name}.docx','w') as z:
        for path,data in parts.items():
            info=ZipInfo(path,date_time=(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
print('Created unsupported and matched controls.')
