"""Original OOXML/art controls for whole-picture scene resizing."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import json
from lxml import etree as E
from top_bottom_flow_fixture import make,drawing,paragraph,W,WP,A,PIC,R
OUT=Path(__file__).resolve().parents[1]/'tests/fixtures/retained-picture-resize'
CASES=[dict(id=1,name='Ellipse',geometry='ellipse'),dict(id=2,name='Cropped flipped inline',geometry='ellipse',inline=True,crop=True),dict(id=3,name='Physical outline',outline=True),dict(id=4,name='Backing fill',fill=True),dict(id=5,name='Physical shadow',geometry='ellipse',shadow=True),dict(id=6,name='3D contour',threeD=True),dict(id=7,name='3D distinct inner locked',threeD=True,inner=True,locked=True),dict(id=8,name='Relative size protected',relative=True),dict(id=9,name='Custom clipping path',custom=True)]
def build():
    parts=make(15);body=[]
    def add(parent,name,**attrs):return E.SubElement(parent,f'{{{A}}}{name}',{k:str(v) for k,v in attrs.items()})
    for case in CASES:
        body.append(paragraph(case['name'],page_break=case['id']>1))
        root=E.fromstring(f'<root xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}">{drawing(case["id"],30,60)}</root>')
        frame=root.find(f'.//{{{WP}}}anchor');frame.set('behindDoc','0');frame.find(f'{{{WP}}}wrapTopAndBottom').tag=f'{{{WP}}}wrapNone'
        if case.get('inline'):
            frame.tag=f'{{{WP}}}inline';frame.attrib.clear()
            for node in list(frame):
                if E.QName(node).localname in ['simplePos','positionH','positionV','wrapNone']:frame.remove(node)
        props=root.find(f'.//{{{PIC}}}spPr');props.find(f'{{{A}}}prstGeom').set('prst',case.get('geometry','rect'))
        if case.get('custom'):
            props.remove(props.find(f'{{{A}}}prstGeom'))
            props.append(E.fromstring(f'<a:custGeom xmlns:a="{A}"><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="50" y="0"/></a:moveTo><a:cubicBezTo><a:pt x="100" y="0"/><a:pt x="100" y="100"/><a:pt x="50" y="100"/></a:cubicBezTo><a:lnTo><a:pt x="0" y="50"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>'))
        if case.get('crop'):
            props.find(f'{{{A}}}xfrm').set('flipH','1');fill=root.find(f'.//{{{PIC}}}blipFill');fill.insert(1,E.Element(f'{{{A}}}srcRect',l='10000',r='20000',t='5000',b='0'))
        if case.get('outline'):
            line=add(props,'ln',w=38100,cap='rnd');add(add(line,'solidFill'),'srgbClr',val='C020D0');add(line,'round')
        if case.get('fill'):add(add(props,'solidFill'),'srgbClr',val='80D020')
        if case.get('shadow'):
            shadow=add(add(props,'effectLst'),'outerShdw',blurRad=50800,dist=76200,dir=2700000,algn='ctr',rotWithShape=1);add(add(shadow,'srgbClr',val='8040C0'),'alpha',val=60000)
        if case.get('threeD'):
            scene=add(props,'scene3d');add(scene,'camera',prst='orthographicFront');add(scene,'lightRig',rig='threePt',dir='t');solid=add(props,'sp3d',extrusionH=127000,contourW=25400);add(add(solid,'contourClr'),'srgbClr',val='202060')
        if case.get('inner'):
            extent=props.find(f'{{{A}}}xfrm/{{{A}}}ext');extent.set('cx','952500');extent.set('cy','685800')
        if case.get('locked'):add(root.find(f'.//{{{WP}}}cNvGraphicFramePr'),'graphicFrameLocks',noChangeAspect=1)
        if case.get('relative'):
            ns='http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing';relative=E.SubElement(frame,f'{{{ns}}}sizeRelH',relativeFrom='page');E.SubElement(relative,f'{{{ns}}}pctWidth').text='25000'
        if case['id']==1:
            # Inactive vendor-extension placeholders inherit mc:Ignorable from the document.
            ns='http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing'
            for axis,value in [('H','Width'),('V','Height')]:
                relative=E.SubElement(frame,f'{{{ns}}}sizeRel{axis}',relativeFrom='margin')
                E.SubElement(relative,f'{{{ns}}}pct{value}').text='0'
        body.append(paragraph(drawings=E.tostring(root[0],encoding='unicode')))
        body.append(paragraph('Text remains editable.'))
    body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
    parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="wp14"><w:body>{"".join(body)}</w:body></w:document>'
    OUT.mkdir(parents=True,exist_ok=True)
    with ZipFile(OUT/'control.docx','w') as z:
        for name,value in parts.items():
            info=ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,value)
    (OUT/'cases.json').write_text(json.dumps(CASES,indent=2)+'\n',encoding='utf-8')
if __name__=='__main__':build()
