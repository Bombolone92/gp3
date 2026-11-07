"""Original OOXML arrowhead control (tests/fixtures/arrowheads/control.docx): straight lines with every line-end type and size. Run from tools/: python3 arrowheads_fixture.py <out.docx>"""
import sys
sys.path.insert(0, '.')
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts as shell, W
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'; A='http://schemas.openxmlformats.org/drawingml/2006/main'; WPS='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
def line(i, kind, x, y, w='med', l='med', pen=19050):
    return (f'<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="{i}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>'
      f'<wp:positionH relativeFrom="page"><wp:posOffset>{x}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>{y}</wp:posOffset></wp:positionV>'
      f'<wp:extent cx="1828800" cy="0"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="{i}" name="Line {i}"/><wp:cNvGraphicFramePr/>'
      f'<a:graphic><a:graphicData uri="{WPS}"><wps:wsp><wps:cNvCnPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>'
      f'<a:ln w="{pen}"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:headEnd type="{kind}" w="{w}" len="{l}"/><a:tailEnd type="{kind}" w="{w}" len="{l}"/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>')
kinds=['triangle','arrow','stealth','diamond','oval']
runs=''.join(line(i+1,k,914400,914400+i*640080) for i,k in enumerate(kinds))
runs+=''.join(line(10+i,'triangle',3657600,914400+i*640080,w,l) for i,(w,l) in enumerate([('sm','sm'),('lg','lg'),('sm','lg'),('lg','sm')]))
runs+=''.join(line(20+i,'arrow',3657600,914400+(4+i)*640080,'med','med',pen) for i,pen in enumerate([6350,76200]))
body=f'<w:p><w:r><w:t>Arrowheads</w:t></w:r>{runs}</w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
parts=dict(shell); parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:wps="{WPS}"><w:body>{body}</w:body></w:document>'
with ZipFile(sys.argv[1],'w',ZIP_DEFLATED) as z:
    for n,b in parts.items(): z.writestr(n,b)
