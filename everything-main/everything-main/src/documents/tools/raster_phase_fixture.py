"""Independent, original bitmap scale/phase controls; no corpus assets or fonts."""
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
from hashlib import sha256
from PIL import Image, ImageDraw
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'tests/fixtures/raster-phase'
NS = {'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
      'a':'http://schemas.openxmlformats.org/drawingml/2006/main',
      'pic':'http://schemas.openxmlformats.org/drawingml/2006/picture',
      'r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
def node(parent, qname, **attrs):
    prefix, local = qname.split(':')
    return E.SubElement(parent, '{'+NS[prefix]+'}'+local, **{k:str(v) for k,v in attrs.items()})
def xml(element):
    return E.tostring(element, xml_declaration=True, encoding='UTF-8', standalone=True)

def build(holdout=False):
    image = Image.new('RGB', (625,300), 'white')
    draw = ImageDraw.Draw(image)
    for x in range(10,615,3):
        draw.line((x,10,x,80),fill='#222222',width=1)
    draw.rectangle((10,100,614,289),outline='#202020',width=4)
    draw.line((20,275,590,110),fill='#1865B0',width=9)
    draw.ellipse((170,115,330,275),outline='#AA4422',width=7)
    draw.rectangle((430,120,560,260),fill='#506070')
    if holdout:
        draw.rectangle((0,0,624,299),fill='white')
        for y in range(12,90,4):draw.line((12,y,612,y),fill='#364A63',width=2)
        draw.polygon([(12,120),(300,120),(300,280),(12,280)],fill='#995A31')
        draw.polygon([(340,110),(610,280),(340,280)],fill='#275E49')
        for x in range(355,610,17):draw.line((x,110,x,280),fill='white',width=3)
        draw.line((10,95,614,95),fill='#151515',width=4)
    media={}
    for fmt,ext in [('PNG','png'),('TIFF','tif')]:
        out=BytesIO();image.save(out,format=fmt);media['word/media/pattern.'+ext]=out.getvalue()
    document=E.Element('{'+NS['w']+'}document',nsmap=NS)
    body=node(document,'w:body');cases=[]
    for page,width in enumerate([63.4999,103.5001] if holdout else [72,111],1):
        p=node(body,'w:p')
        if page==2:
            node(node(p,'w:pPr'),'w:pageBreakBefore').set('{'+NS['w']+'}val','1')
        for row,phase in enumerate([0,.25,.4999,.5001,.75] if holdout else [0,.2,.4,.6,.8]):
            for column,ext in enumerate(['png','tif']):
                identity=len(cases)+1
                x=80+column*260+phase;y=60+row*70+phase;height=width*300/625
                run=node(p,'w:r');drawing=node(run,'w:drawing')
                anchor=node(drawing,'wp:anchor',distT=0,distB=0,distL=0,distR=0,simplePos=0,relativeHeight=identity,behindDoc=0,locked=0,layoutInCell=1,allowOverlap=1)
                node(anchor,'wp:simplePos',x=0,y=0)
                for axis,value in [('H',x),('V',y)]:
                    node(node(anchor,'wp:position'+axis,relativeFrom='page'),'wp:posOffset').text=str(round(value*9525))
                extent={'cx':round(width*9525),'cy':round(height*9525)}
                node(anchor,'wp:extent',**extent);node(anchor,'wp:wrapNone')
                name=f'page-{page}-phase-{phase}-{ext}'
                node(anchor,'wp:docPr',id=identity,name=name)
                node(node(anchor,'wp:cNvGraphicFramePr'),'a:graphicFrameLocks',noChangeAspect=1)
                graphic=node(anchor,'a:graphic');data=node(graphic,'a:graphicData',uri=NS['pic']);pic=node(data,'pic:pic')
                nv=node(pic,'pic:nvPicPr');node(nv,'pic:cNvPr',id=identity,name=name);node(nv,'pic:cNvPicPr')
                fill=node(pic,'pic:blipFill');node(fill,'a:blip').set('{'+NS['r']+'}embed','rId'+str(column+1));node(node(fill,'a:stretch'),'a:fillRect')
                props=node(pic,'pic:spPr');xf=node(props,'a:xfrm');node(xf,'a:off',x=0,y=0);node(xf,'a:ext',**extent);node(node(props,'a:prstGeom',prst='rect'),'a:avLst')
                cases.append(dict(name=name,page=page,format=ext,phase=phase,x=round(x*9525)/9525,y=round(y*9525)/9525,width=extent['cx']/9525,height=extent['cy']/9525))
    section=node(body,'w:sectPr');size=node(section,'w:pgSz');size.set('{'+NS['w']+'}w','11520');size.set('{'+NS['w']+'}h','8400')
    margins=node(section,'w:pgMar')
    for key in ['top','right','bottom','left','header','footer','gutter']:margins.set('{'+NS['w']+'}'+key,'0')
    parts={**media,'word/document.xml':xml(document),
      '[Content_Types].xml':b'''<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="tif" ContentType="image/tiff"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>''',
      '_rels/.rels':b'''<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>''',
      'word/_rels/document.xml.rels':b'''<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pattern.png"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pattern.tif"/></Relationships>'''}
    out=BytesIO()
    with ZipFile(out,'w',ZIP_DEFLATED) as archive:
        for name,data in sorted(parts.items()):
            entry=ZipInfo(name,(2020,1,1,0,0,0));entry.compress_type=ZIP_DEFLATED;archive.writestr(entry,data)
    return out.getvalue(),dict(pageWidthPt=576,pageHeightPt=420,cases=cases,sourceRgbaSha256=sha256(image.convert('RGBA').tobytes()).hexdigest())

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--holdout',action='store_true');args=parser.parse_args()
    data,cases=build(args.holdout);folder=FOLDER/'holdout' if args.holdout else FOLDER;folder.mkdir(parents=True,exist_ok=True)
    (folder/'control.docx').write_bytes(data)
    (folder/'cases.json').write_text(json.dumps(dict(sourceSha256=sha256(data).hexdigest(),**cases),indent=2)+'\n',encoding='utf8')
    print(sha256(data).hexdigest())
