"""Original thin-outline controls, authored directly as OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from canvas_first_section_fixture import parts as base, W

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/shape-display-resolution'
folder.mkdir(parents=True,exist_ok=True)
A='http://schemas.openxmlformats.org/drawingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
S='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
parts=dict(base)
body='<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr><w:t>Thin outline resolution controls</w:t></w:r></w:p>'
for i,angle in enumerate([0,3,15,45]):
    shape=f'<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm rot="{angle*60000}"><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="6350" cap="flat"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:miter lim="800000"/></a:ln></wps:spPr><wps:bodyPr><a:noAutofit/></wps:bodyPr></wps:wsp>'
    body+=f'<w:p><w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="{i}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>{12700*(100+140*i)}</wp:posOffset></wp:positionV><wp:extent cx="1828800" cy="914400"/><wp:wrapNone/><wp:docPr id="{i+1}" name="Half-point outline {angle} degrees"/><a:graphic><a:graphicData uri="{S}">{shape}</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:wps="{S}"><w:body>{body}</w:body></w:document>'
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as archive:
    for name,data in parts.items():
        info=ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED
        archive.writestr(info,data)
print(folder/'control.docx')
