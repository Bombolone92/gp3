"""Authored booklet controls for tables, stories, anchors, wrapping and numbering."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/book-fold'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
S = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'

def p(text,props='',runs=''):
    before,after=('',props) if props.startswith('<w:jc') else (props,'')
    return f'<w:p><w:pPr>{before}<w:spacing w:after="0"/>{after}</w:pPr>{runs}<w:r><w:t>{text}</w:t></w:r></w:p>'

def shape(index,relative,x,y,color,wrap=False):
    return f'''<w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="{index}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1" distT="0" distB="0" distL="0" distR="0">
    <wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="{relative}"><wp:posOffset>{x*12700}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="{'paragraph' if wrap else 'page'}"><wp:posOffset>{y*12700}</wp:posOffset></wp:positionV><wp:extent cx="381000" cy="304800"/>{'<wp:wrapSquare wrapText="bothSides"/>' if wrap else '<wp:wrapNone/>'}<wp:docPr id="{index}" name="Box {index}"/><a:graphic><a:graphicData uri="{S}"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="381000" cy="304800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'''

with ZipFile(folder/'forward.docx') as z:
    original = {n:z.read(n) for n in z.namelist()}
for name,start in [('content',1),('numbered',2),('content-gutter',1),('content-even',1)]:
    parts=dict(original)
    body=[]
    for page in range(4):
        drawings=shape(page*3+1,'page',30,260,'CC2233')+shape(page*3+2,'margin',0,290,'228844')+shape(page*3+3,'column',46,84,'2244CC',True)
        body.append(p(f'Page {page+1} content', '<w:pageBreakBefore/>' if page else '',drawings))
        rows=''.join('<w:tr>'+''.join(f'<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/><w:shd w:val="clear" w:fill="EEEEEE"/></w:tcPr>{p(f"Cell {page+1}.{r+1}.{c+1}")}</w:tc>' for c in range(2))+'</w:tr>' for r in range(2))
        body.append(f'<w:tbl><w:tblPr><w:tblW w:w="3600" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/></w:tblGrid>{rows}</w:tbl>')
        body.append(p(' '.join(f'word{i}' for i in range(60))))
    section=f'<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="7920" w:h="12240" w:orient="landscape"/><w:pgMar w:top="720" w:right="1080" w:bottom="900" w:left="1440" w:header="200" w:footer="200" w:gutter="0"/><w:pgNumType w:start="{start}"/></w:sectPr>'
    if name=='content-gutter':section=section.replace('w:gutter="0"','w:gutter="180"')
    if name=='content-even':
        section=section.replace('<w:footerReference', '<w:headerReference w:type="even" r:id="header"/><w:footerReference',1).replace('<w:pgSz','<w:footerReference w:type="even" r:id="footer"/><w:pgSz',1)
        parts['word/settings.xml']=parts['word/settings.xml'].replace(b'<w:bookFoldPrinting/>',b'<w:evenAndOddHeaders/><w:bookFoldPrinting/>')
    parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:wps="{S}" xmlns:mc="{MC}" mc:Ignorable="wps"><w:body>{"".join(body)}{section}</w:body></w:document>'.encode()
    parts['word/header.xml']=f'<w:hdr xmlns:w="{W}">{p("Header left")}</w:hdr>'.encode()
    parts['word/footer.xml']=f'<w:ftr xmlns:w="{W}">{p("Footer right", "<w:jc w:val=\"right\"/>")}</w:ftr>'.encode()
    rels=E.fromstring(parts['word/_rels/document.xml.rels']);types=E.fromstring(parts['[Content_Types].xml'])
    for kind in ['header','footer']:
        E.SubElement(rels,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',Id=kind,Type=R+'/'+kind,Target=kind+'.xml')
        E.SubElement(types,'{http://schemas.openxmlformats.org/package/2006/content-types}Override',PartName='/word/'+kind+'.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.'+kind+'+xml')
    parts['word/_rels/document.xml.rels']=E.tostring(rels);parts['[Content_Types].xml']=E.tostring(types)
    with ZipFile(folder/(name+'.docx'),'w',ZIP_DEFLATED) as z:
        for path,data in parts.items():
            info=ZipInfo(path,(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
