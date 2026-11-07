"""Independently authored dense polygon exceeding the former path-command cap."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from math import sin,cos,pi
from canvas_first_section_fixture import parts as base,W,R
from canvas_custom_geometry_fixture import A,WP,S
ROOT=Path(__file__).resolve().parents[1]
SEGMENTS=16384

def generate():
 path=''
 for i in range(SEGMENTS+1):
  x=round(100000+100000*cos(i*2*pi/SEGMENTS));y=round(100000+100000*sin(i*2*pi/SEGMENTS))
  tag='moveTo' if i==0 else 'lnTo';path+=f'<a:{tag}><a:pt x="{x}" y="{y}"/></a:{tag}>'
 path+='<a:close/>'
 shape=f'<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3810000" cy="3048000"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst><a:path w="200000" h="200000">{path}</a:path></a:pathLst></a:custGeom><a:solidFill><a:srgbClr val="208060"/></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="208060"/></a:solidFill></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>'
 anchor=f'<wp:anchor simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>1270000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>1905000</wp:posOffset></wp:positionV><wp:extent cx="3810000" cy="3048000"/><wp:wrapNone/><wp:docPr id="1" name="Dense polygon"/><a:graphic><a:graphicData uri="{S}">{shape}</a:graphicData></a:graphic></wp:anchor>'
 body=f'<w:p><w:r><w:t>Dense geometry</w:t></w:r></w:p><w:p><w:r><w:drawing>{anchor}</w:drawing></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
 parts=dict(base);parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:wps="{S}"><w:body>{body}</w:body></w:document>'
 with ZipFile(ROOT/'public/fixtures/dense-path.docx','w',ZIP_DEFLATED) as z:
  for name,data in parts.items():z.writestr(name,data)
if __name__=='__main__':generate()
