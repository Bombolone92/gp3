"""Independently authored OOXML controls for an exact semibold face name."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from io import BytesIO
from hashlib import sha256
import json
from PIL import Image
from lxml import etree as E
ROOT=Path(__file__).resolve().parents[1];FOLDER=ROOT/'tests/fixtures/semibold-face'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
PIC='http://schemas.openxmlformats.org/drawingml/2006/picture'
def drawing_node(parent,namespace,tag,**attributes):
    return E.SubElement(parent,'{'+namespace+'}'+tag,{key:str(value) for key,value in attributes.items()})
def element(parent,name,**attributes):
    node=E.SubElement(parent,'{'+W+'}'+name)
    for key,value in attributes.items():node.set('{'+W+'}'+key,str(value))
    return node
def build():
    document=E.Element('{'+W+'}document',nsmap={'w':W,'r':R,'wp':WP,'a':A,'pic':PIC});body=element(document,'body');cases=[]
    for index,(bold,italic) in enumerate([(False,False),(False,True),(True,False),(True,True)]):
        text=f'Semibold face {index+1}: Clear words 0123456789, AVATAR and minimum.'
        p=element(body,'p');properties=element(p,'pPr');element(properties,'spacing',before=0,after=240,line=240,lineRule='auto')
        run=element(p,'r');style=element(run,'rPr');element(style,'rFonts',ascii='Source Sans Pro SemiBold',hAnsi='Source Sans Pro SemiBold')
        if bold:element(style,'b')
        if italic:element(style,'i')
        element(style,'sz',val=28);element(run,'t').text=text;cases.append(dict(text=text,bold=bold,italic=italic,font='Source Sans Pro SemiBold',sizePt=14))
        inline=drawing_node(element(element(p,'r'),'drawing'),WP,'inline',distT=0,distB=0,distL=0,distR=0)
        drawing_node(inline,WP,'extent',cx=19050,cy=95250);drawing_node(inline,WP,'docPr',id=index+1,name=f'advance-marker-{index+1}')
        graphic=drawing_node(inline,A,'graphic');data=drawing_node(graphic,A,'graphicData',uri=PIC);picture=drawing_node(data,PIC,'pic')
        nv=drawing_node(picture,PIC,'nvPicPr');drawing_node(nv,PIC,'cNvPr',id=0,name='marker');drawing_node(nv,PIC,'cNvPicPr')
        fill=drawing_node(picture,PIC,'blipFill');blip=drawing_node(fill,A,'blip');blip.set('{'+R+'}embed','rId1');drawing_node(drawing_node(fill,A,'stretch'),A,'fillRect')
        shape=drawing_node(picture,PIC,'spPr');transform=drawing_node(shape,A,'xfrm');drawing_node(transform,A,'off',x=0,y=0);drawing_node(transform,A,'ext',cx=19050,cy=95250);drawing_node(drawing_node(shape,A,'prstGeom',prst='rect'),A,'avLst')
    section=element(body,'sectPr');element(section,'pgSz',w=12240,h=15840);element(section,'pgMar',top=720,right=720,bottom=720,left=720,header=360,footer=360,gutter=0)
    marker=BytesIO();Image.new('RGB',(2,10),'black').save(marker,format='PNG')
    parts={'[Content_Types].xml':b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
           '_rels/.rels':b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
           'word/document.xml':E.tostring(document,xml_declaration=True,encoding='UTF-8',standalone=True),
           'word/_rels/document.xml.rels':b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/marker.png"/></Relationships>',
           'word/media/marker.png':marker.getvalue()}
    output=BytesIO()
    with ZipFile(output,'w') as archive:
        for name,data in parts.items():
            info=ZipInfo(name,(2026,10,4,12,0,0));info.create_system=0;info.external_attr=0o600<<16;archive.writestr(info,data,compress_type=ZIP_DEFLATED)
    data=output.getvalue();return data,dict(sourceSha256=sha256(data).hexdigest(),cases=cases)
if __name__=='__main__':
    data,cases=build();FOLDER.mkdir(parents=True,exist_ok=True);(FOLDER/'control.docx').write_bytes(data);(FOLDER/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf8')
